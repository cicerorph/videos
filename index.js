require('dotenv').config();
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const sanitizeHtml = require('sanitize-html');
const { Webhook } = require('simple-discord-webhooks');
const extractFrames = require('ffmpeg-extract-frames');
const conf = require('./config.json');
const cookieSession = require('cookie-session') // Add Cookie Session for auth
const axios = require('axios');
const { uuid } = require('uuidv4');
const cors = require('cors')
const BunnyStorage = require('bunnycdn-storage').default;

console.log(process.env)

const bunnyStorage = new BunnyStorage(process.env.BUNNY_STORAGE_ACCESS_KEY, process.env.BUNNY_STORAGE_ZONE_NAME);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.set('view engine', 'ejs');

Array.prototype.randoms = function () {
    const result = [...this];
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result.slice(0, 3);
};

// Upload middleware using multer
const storage = multer.memoryStorage(); // We use memory storage since we're uploading directly to BunnyCDN

const upload = multer({
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: function (req, file, cb) {
        if (!file.mimetype.startsWith('video/')) {
            return cb(new Error('You need to upload a video matey'));
        }
        cb(null, true);
    },
    storage: storage
});

const tokensFilePath = path.join(__dirname, 'tokens.json');

let singleTokens = [];

// Load existing tokens from tokens.json
try {
    const tokensFileContent = fs.readFileSync(tokensFilePath, 'utf8');
    singleTokens = JSON.parse(tokensFileContent);
} catch (err) {
    // Ignore if the file doesn't exist or is invalid JSON
}

const webhook = new Webhook(conf.WEBHOOK);

// Function to save tokens to tokens.json
function saveTokensToFile() {
    fs.writeFileSync(tokensFilePath, JSON.stringify(singleTokens));
}

const token = crypto.randomBytes(8).toString('hex');

webhook.send(`**I GOT RESTARTED**\nPermanent Token: ${token}\nLink to Generate an single token: [HERE](https://videos.mubi.tech/generateToken?token=${token})`);

app.use(
  cookieSession({
    name: 'session',
    keys: [conf.SECRET], // Add your secret key(s) here
  })
);

// fuck u bunny
app.post('/upload', async (req, res) => {
    return res.status(400).send("Not accepting videos.");
    /* if (!req.session.name) {
        return res.send("Not logged in");
    }

    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }

    // Generate a unique filename for the video
    const videoId = Date.now() + path.extname(req.file.originalname);
    const localVideoPath = `./local-videos/${videoId}`; // Local path to save video

    // Save the video file locally
    try {
        fs.writeFileSync(localVideoPath, req.file.buffer);
    } catch (error) {
        console.error('Error saving video locally:', error);
        return res.status(500).send('Error saving video.');
    }

    const videoPath = `videos/${videoId}`;
    try {
        await bunnyStorage.upload(req.file.buffer, videoPath);
    } catch (error) {
        console.error('Error uploading video to BunnyCDN:', error);
        return res.status(500).send('Error uploading video.');
    }

    // Extract a frame for the thumbnail
    const thumbnailPath = `thumbnails/${videoId}.png`;
    try {
        await extractFrames({
            input: localVideoPath,
            output: `./temp-thumbnail.png`,
            offsets: [0]
        });

        // Upload the thumbnail to BunnyCDN
        const thumbnailBuffer = fs.readFileSync('./temp-thumbnail.png');
        await bunnyStorage.upload(thumbnailBuffer, thumbnailPath);
        fs.unlinkSync('./temp-thumbnail.png'); // Delete the temporary thumbnail file
    } catch (error) {
        console.error('Error creating or uploading thumbnail:', error);
        return res.status(500).send('Error processing thumbnail.');
    } finally {
        // Delete the local video file regardless of the outcome
        fs.unlinkSync(localVideoPath);
    }

    const videos = JSON.parse(fs.readFileSync('./videos.json', 'utf8'));
    const title = sanitizeHtml(req.body.title).trim().substring(0, 30);
    const description = sanitizeHtml(req.body.description).trim().replace(/\r\n/g, '\n').substring(0, 100);

    // Construct the BunnyCDN URL for the video and thumbnail files
    const bunnyCdnVideoUrl = `https://${process.env.BUNNY_STORAGE_ZONE_NAME}.b-cdn.net/${videoPath}`;
    const bunnyCdnThumbnailUrl = `https://${process.env.BUNNY_STORAGE_ZONE_NAME}.b-cdn.net/${thumbnailPath}`;

    videos.push({
        id: videoId,
        uploader: req.session.name,
        url: bunnyCdnVideoUrl,
        thumbnail: bunnyCdnThumbnailUrl,
        title: title,
        description: description,
    });

    fs.writeFileSync('./videos.json', JSON.stringify(videos));

    res.redirect(`/videos/${videoId}`);

    webhook.send(`**A video got uploaded**\nTitle: ${title}\nLink: [CLICK HERE](https://videos.mubi.tech/videos/${videoId})`);

    */
});

app.get('/upload', (req, res) => {
    res.render('upload');
});

app.get('/delete', (req, res) => {
    res.render('deletevideo');
});

app.get('/videos', (req, res) => {
    res.redirect("https://videos.mubi.tech/")
});

// Middleware to check if the user is logged in
app.use((req, res, next) => {
    if (req.session && req.session.name) {
        res.locals.user = req.session.name; // Pass the user's name to all views
        next();
    } else {
        next();
    }
});

app.post('/remove', (req, res) => {
    const videoId = req.body.id;
    const Uptoken = req.body.token;

    if (!Uptoken === token) {
        res.render("failedToken");
        return;
    }

    // Load existing videos from videos.json
    const videosPath = './videos.json';
    let videos = [];

    try {
        const videosFileContent = fs.readFileSync(videosPath, 'utf8');
        videos = JSON.parse(videosFileContent);
    } catch (err) {
        console.error('Error reading videos file:', err);
        res.status(500).send('Internal Server Error');
        return;
    }

    // Find the index of the video to be deleted
    const videoIndex = videos.findIndex(video => video.id === videoId);

    if (videoIndex !== -1) {
        // Delete the video file from the uploads folder
        const videoPath = 'videos/' + videos[videoIndex];
        const thumbnailPath = 'thumbnails/' + videos[videoIndex] + '.png';

        try {
            bunnyStorage.delete(videoPath);
            bunnyStorage.delete(thumbnailPath);
        } catch (err) {
            console.error('Error deleting video file:', err);
            res.status(500).send('Internal Server Error');
            return;
        }

        // Remove the video entry from videos.json
        videos.splice(videoIndex, 1);

        // Save the updated videos array to videos.json
        fs.writeFileSync(videosPath, JSON.stringify(videos));

        res.redirect('/');
    } else {
        res.status(404).render('error', { error: 'Video not found' });
    }
});


// Updated route handling for the main page
app.get('/', (req, res) => {
    const videos = JSON.parse(fs.readFileSync('./videos.json', 'utf8'));
    if (res.locals.user) {
        // Render a different view when the user is logged in
        res.render('loggedinhome', { user: res.locals.user, videos: videos });
    } else {
        res.render('home', { videos: videos });
    }
});

app.get('/videos/:id', (req, res, next) => {
    const videos = JSON.parse(fs.readFileSync('./videos.json', 'utf8'));
    const videoIndex = videos.findIndex(video => video.id === req.params.id);
    if (videoIndex !== -1) {
        const video = videos[videoIndex];
        videos.splice(videoIndex, 1);
        if (video.uploader === undefined) {
            video.uploader === "Unknown"
        }
        
        res.render('watchvideo', { video: video, videos: videos.randoms(), uploader: video.uploader });
    } else {
        next();
    }
});

app.get('/shorts/:id', (req, res, next) => {
    const videos = JSON.parse(fs.readFileSync('./videos.json', 'utf8'));
    const videoIndex = videos.findIndex(video => video.id === req.params.id);
    if (videoIndex !== -1) {
        const video = videos[videoIndex];
        videos.splice(videoIndex, 1);
        if (video.uploader === undefined) {
            video.uploader === "Unknown"
        }
        
        res.render('shorts', { video: video, videos: videos.randoms(), uploader: video.uploader });
    } else {
        next();
    }
});

app.get('/generateToken', (req, res) => {
    if (req.query.token !== token) {
        return res.render('failedToken');
    }

    const manyTokens = parseInt(req.query.many) || 1; // Default to 1 if 'many' parameter is not provided

    if (isNaN(manyTokens) || manyTokens <= 0) {
        return res.status(400).send('Invalid value for "many" parameter');
    }

    const generatedTokens = Array.from({ length: manyTokens }, () => crypto.randomBytes(8).toString('hex'));
    
    singleTokens.push(...generatedTokens);
    saveTokensToFile();
    
    if (manyTokens === 1) {
        res.send(generatedTokens[0]);
    } else {
        res.send(generatedTokens);
    }
});

app.get('/login', (req, res) => {
    let redirectLocation = new Buffer('https://videos.mubi.tech/api/auth').toString('base64');
    res.redirect(`https://auth.itinerary.eu.org/auth/?redirect=${redirectLocation}&name=MubiVideos`);
});

app.get('/logout', (req, res) => {
    req.session = null
    res.redirect("https://videos.mubi.tech/videos")
});

app.get('/test', (req, res) => {
    res.send(req.session);
    console.log(req.session);
});

app.get('/token', (req, res) => {
    if (req.session.name === "MubiLop") {
        res.send(token)
    }
});

app.get('/api/auth', async (req, res) => {
  const { privateCode } = req.query;

  try {
    const response = await axios.get(`https://auth.itinerary.eu.org/api/auth/verifyToken?privateCode=${privateCode}`);
    const data = response.data;

    if (data.valid === true && data.redirect === 'https://videos.mubi.tech/api/auth') {
      console.log(data.username);

      // Now you can safely access req.session
      req.session.name = data.username;

      // Redirect to the main page after successful authentication
      res.redirect('https://videos.mubi.tech');
    } else {
      res.status(403).json({ error: 'Authentication failed' });
    }
  } catch (error) {
    console.error('Error during authentication:', error.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.use((req, res) => {
    res.status(404).render('error');
});

app.listen(3000, () => {
    console.log('Server is running on port 3000');
});

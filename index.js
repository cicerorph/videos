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

const app = express();
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

const upload = multer({
    limits: { fileSize: 100 * 1024 * 1024 },
    fileFilter: function (req, file, cb) {
        if (!file.mimetype.startsWith('video/')) {
            return cb(new Error('You need to upload a video matey'));
        }
        cb(null, true);
    },
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            cb(null, 'uploads/');
        },
        filename: (req, file, cb) => {
            const randomHash = crypto.randomBytes(8).toString('hex');
            const ext = path.extname(file.originalname);
            cb(null, randomHash + ext);
        },
    }),
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


app.post('/upload', upload.single('video'), async (req, res) => {
    const videoPath = '/uploads/' + req.file.filename;
    if (!req.session.name) {
        res.send("Not logged in")
        return;
    }

    await extractFrames({
        input: '.' + videoPath,
        output: '.' + videoPath + '.png',
        offsets: [
            0,
        ],
    });

    const videos = JSON.parse(fs.readFileSync('./videos.json', 'utf8'));
    const videoIndex = videos.findIndex(video => video.id === req.file.filename);
    if (videoIndex !== -1) {
        videos.splice(videoIndex, 1);
        fs.writeFileSync('./videos.json', JSON.stringify(videos));
    }

    videos.push({ id: req.file.filename, uploader: req.session.name, path: videoPath, thumbnail: videoPath + '.png', title: sanitizeHtml(req.body.title), description: sanitizeHtml(req.body.description).replace('\\r\\n', '\\n') });
    fs.writeFileSync('./videos.json', JSON.stringify(videos));

    res.redirect('/videos/' + req.file.filename);

    webhook.send(`**A video got uploaded**\nLink: [CLICK HERE](https://videos.mubi.tech/videos/${req.file.filename})`);
});

app.post('/delete', async (req, res) => {
    console.log(req.body)
    // Check if req.body is defined
    if (!req.body || !req.body.id || req.body.token !== token) {
      return res.render('failedToken');
    }
  
    const videoId = req.body.id;
  
    // Delete video from videos.json
    const videos = JSON.parse(fs.readFileSync('./videos.json', 'utf8'));
    const videoIndex = videos.findIndex(video => video.id === videoId);
    if (videoIndex !== -1) {
      videos.splice(videoIndex, 1);
      fs.writeFileSync('./videos.json', JSON.stringify(videos));
    }
  
    const videoFilePath1 = `./uploads/${videoId}`;
    if (fs.existsSync(videoFilePath1)) {
      fs.unlinkSync(videoFilePath1);
    }
  
    // Delete video file with extension "id.png"
    const videoFilePath2 = `./uploads/${videoId}.png`;
    if (fs.existsSync(videoFilePath2)) {
      fs.unlinkSync(videoFilePath2);
    }
  
    res.render('videodeleted');
});  

app.post('/delete', (req, res) => {
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
        const videoPath = path.join(__dirname, 'uploads', videos[videoIndex]);
        const thumbnailPath = path.join(__dirname, 'uploads', videos[videoIndex], '.png');

        try {
            fs.unlinkSync(videoPath);
            fs.unlinkSync(thumbnailPath);
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

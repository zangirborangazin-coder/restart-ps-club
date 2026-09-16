const express = require('express');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.static(__dirname));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'new version.html')));
app.listen(port, () => console.log(`RESTART is running on port ${port}`));

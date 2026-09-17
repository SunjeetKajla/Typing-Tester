require('dotenv').config();

const http = require('node:http');
const app = require('./app');
const { createMultiplayerServer } = require('./multiplayer/socket-server');
const PORT = process.env.PORT || 8000;

const httpServer = http.createServer(app);
createMultiplayerServer(httpServer);

httpServer.listen(PORT, () => {
    console.log(`Server is listening at http://localhost:${PORT}`);
});

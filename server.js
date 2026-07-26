const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 정적 파일 제공 (index 파일이 있는 현재 폴더)
app.use(express.static(path.join(__dirname)));

io.on('connection', (socket) => {
    console.log('User has connected');

    socket.on('chat message', (msg) => {
        io.emit('chat message', msg);
    });

    socket.on('disconnect', () => {
        console.log('User has left');
    });
});

// 렌더 서버가 지정해 주는 포트 번호를 자동으로 사용하도록 설정 (아주 중요!)
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`서버가 ${PORT}번 포트에서 실행 중입니다.`);
});
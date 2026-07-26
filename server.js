const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

// 사용자가 사이트에 접속하면 index.html 파일을 보여줌
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 웹소켓 연결 (채팅 로직)
io.on('connection', (socket) => {
  console.log('🟢 New user has Accessed.');

  // 클라이언트가 'chat message'라는 이름으로 데이터를 보내면 실행됨
  socket.on('chat message', (msg) => {
    // 접속한 모든 사람에게 받은 메시지를 다시 보냄 (Broadcast)
    io.emit('chat message', msg);
  });

  // 유저가 연결을 끊었을 때 (창을 닫았을 때)
  socket.on('disconnect', () => {
    console.log('🔴 A user has left.');
  });
});

// 클라우드 포트를 우선 사용 없으면 3000번을 쓰도록 설정
const port = process.env.PORT || 3000;

server.listen(port, () => {
  console.log(`Server Running: 포트 ${port}`);
});
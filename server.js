const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 정적 파일 제공 (index.html 및 이미지 파일 등이 위치한 현재 폴더)
app.use(express.static(path.join(__dirname)));

// 루트 경로로 접속 시 index.html 반환
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Socket.io 실시간 통신 연결 설정
io.on('connection', (socket) => {
  console.log('사용자가 연결되었습니다:', socket.id);

  // 클라이언트로부터 채팅 메시지가 수신되었을 때
  socket.on('chat message', (msg) => {
    // 접속한 모든 클라이언트에게 메시지 브로드캐스트 (전송)
    io.emit('chat message', msg);
  });

  // 메시지 삭제 이벤트를 다른 모든 클라이언트에게 브로드캐스트
  socket.on('delete message', (data) => {
    io.emit('delete message', data);
  });

  // 메시지 수정 이벤트를 다른 모든 클라이언트에게 브로드캐스트
  socket.on('edit message', (data) => {
    io.emit('edit message', data);
  });

  // 사용자의 연결이 끊어졌을 때
  socket.on('disconnect', () => {
    console.log('사용자 연결이 해제되었습니다:', socket.id);
  });
});

// 서버 실행 포트 설정 (기본 3000포트)
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
});
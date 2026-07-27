const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 정적 파일 제공 (public 폴더 기준)
app.use(express.static(__dirname));

// 💾 서버에 대화 내역 저장할 배열
const chatHistory = [];

io.on('connection', (socket) => {
  console.log('새로운 유저가 연결되었습니다.');

  // 1. 신규 접속자에게 이전 대화 내역 전송
  socket.emit('chat history', chatHistory);

  // 2. 클라이언트로부터 메시지 수신
  socket.on('chat message', (data) => {
    const messageData = {
      nickname: data.nickname,
      text: data.text,
      time: data.time,         // 예: "오후 12:02"
      fullDate: data.fullDate, // 예: "2026년 7월 28일 화요일"
      timestamp: Date.now()
    };

    // 서버 대화 내역 배열에 추가
    chatHistory.push(messageData);

    // 전체 접속자에게 실시간 메시지 전송
    io.emit('chat message', messageData);
  });

  socket.on('disconnect', () => {
    console.log('유저 접속 해제');
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
});
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 루트 경로('/')로 접속 시 index.html 파일을 직접 전송 (public 폴더 불필요)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 서버 리셋 시 초기화되는 익명 채널 유저별 랜덤 번호 맵
const randomNicknames = new Map();

// 채널별 채팅 내역 저장소
const channelHistories = {
  general: [],
  random: []
};

// 3개월을 밀리초(ms)로 계산 (90일 기준)
const THREE_MONTHS_MS = 3 * 30 * 24 * 60 * 60 * 1000;

// 3개월이 지난 오래된 메시지를 정리하는 함수
function cleanOldMessages(channel) {
  if (!channelHistories[channel]) return;
  const now = Date.now();
  channelHistories[channel] = channelHistories[channel].filter(msg => {
    const msgTime = msg.timestamp || now;
    return (now - msgTime) <= THREE_MONTHS_MS;
  });
}

io.on('connection', (socket) => {
  console.log('사용자 연결됨:', socket.id);

  // 채널 입장 시 3개월이 지난 메시지는 제외하고 전송
  socket.on('join channel', (channel) => {
    try {
      socket.join(channel);
      if (channelHistories[channel]) {
        cleanOldMessages(channel);
        socket.emit('chat history', { history: channelHistories[channel] });
      } else {
        socket.emit('chat history', { history: [] });
      }
    } catch (err) {
      console.error('채널 입장 처리 오류:', err);
    }
  });

  socket.on('chat message', (msg) => {
    try {
      if (!msg || !msg.channel) return;

      msg.timestamp = Date.now();

      // #random 채널일 경우 서버 메모리에서 유저별 번호 관리 (1 ~ 999 이하의 자연수)
      if (msg.channel === 'random') {
        if (!randomNicknames.has(msg.uid)) {
          const randomNum = Math.floor(Math.random() * 999) + 1;
          randomNicknames.set(msg.uid, randomNum);
        }
        const assignedNum = randomNicknames.get(msg.uid);
        msg.nickname = String(assignedNum);
      }

      if (!channelHistories[msg.channel]) {
        channelHistories[msg.channel] = [];
      }

      // 새 메시지 추가 및 3개월 경과 메시지 일괄 청소
      channelHistories[msg.channel].push(msg);
      cleanOldMessages(msg.channel);

      // 해당 채널에 실시간 메시지 브로드캐스트
      io.to(msg.channel).emit('chat message', msg);
    } catch (err) {
      console.error('메시지 전송 처리 오류:', err);
    }
  });

  socket.on('disconnect', () => {
    console.log('사용자 연결 해제:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
});
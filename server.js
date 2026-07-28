const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const admin = require('firebase-admin');
const path = require('path');

// 1. Firebase Admin SDK 초기화 (환경 변수 사용, 중복 초기화 방지)
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// public 폴더 내 정적 파일 제공
app.use(express.static(path.join(__dirname, 'public')));

// 루트 경로 접속 시 index.html 반환
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 2. 채널별 대화 내역 불러오기 함수 (데이터베이스 연동)
async function sendChannelHistory(socket, channel) {
  try {
    const snapshot = await db.collection('messages')
      .where('channel', '==', channel)
      .orderBy('timestamp', 'asc')
      .limit(100)
      .get();

    const history = [];
    snapshot.forEach((doc) => {
      history.push(doc.data());
    });

    socket.emit('chat history', { channel, history });
  } catch (error) {
    console.error(`[${channel}] 대화 내역 불러오기 실패:`, error);
    socket.emit('chat history', { channel, history: [] });
  }
}

// 3. Socket.io 실시간 통신 및 데이터베이스 저장 관리
io.on('connection', (socket) => {
  console.log('유저 접속 완료:', socket.id);

  // 채널 입장 처리
  socket.on('join channel', (channel) => {
    socket.rooms.forEach((room) => {
      if (room !== socket.id) socket.leave(room);
    });

    socket.join(channel);
    console.log(`유저[${socket.id}]가 [${channel}] 채널로 이동했습니다.`);

    // DB에서 해당 채널 대화 내역 전송
    sendChannelHistory(socket, channel);
  });

  // 메시지 수신 및 Firestore DB 저장
  socket.on('chat message', async (data) => {
    const channel = data.channel || 'general';

    const messageData = {
      channel: channel,
      nickname: data.nickname || '손님',
      text: data.text,
      time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    };

    try {
      // Firestore 'messages' 컬렉션에 메시지 저장
      await db.collection('messages').add(messageData);

      // 같은 채널에 있는 모든 사용자에게 메시지 전송
      io.to(channel).emit('chat message', messageData);
    } catch (error) {
      console.error('메시지 저장 및 전송 실패:', error);
    }
  });

  socket.on('disconnect', () => {
    console.log('유저 연결 해제:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
});
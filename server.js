const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const admin = require('firebase-admin');
const path = require('path');

// 1. Firebase Admin SDK 연결 (서비스 계정 키 파일)
const serviceAccount = require('./firebase-key.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore(); // Firestore 데이터베이스 인스턴스

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// public 폴더 내 정적 파일(index.html 등) 제공
app.use(express.static(path.join(__dirname, 'public')));

// 🟢 Firestore에서 해당 채널의 과거 대화 내역을 읽어 유저에게 전송하는 함수
async function sendChannelHistory(socket, channel) {
  try {
    const snapshot = await db.collection('messages')
      .where('channel', '==', channel)
      .orderBy('timestamp', 'asc')
      .limit(100) // 최근 100개 메시지
      .get();

    const history = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        channel: data.channel,
        nickname: data.nickname,
        text: data.text,
        time: data.time,
        fullDate: data.fullDate,
        senderId: data.senderId
      };
    });

    // 접속한 유저 단 한 명에게만 과거 내역 전달
    socket.emit('chat history', { channel, history });
  } catch (error) {
    console.error(`[${channel}] 대화 내역 불러오기 실패:`, error);
    socket.emit('chat history', { channel, history: [] });
  }
}

io.on('connection', (socket) => {
  console.log('유저 접속 완료:', socket.id);

  // 접속 즉시 기본 채널('general') 입장 및 대화 내역 전송
  const defaultChannel = 'general';
  socket.join(defaultChannel);
  sendChannelHistory(socket, defaultChannel);

  // 🟢 1. 유저가 채널을 이동했을 때 처리
  socket.on('join channel', (channel) => {
    // 기존에 있던 방 퇴장 (자신의 socket.id 방은 제외)
    socket.rooms.forEach((room) => {
      if (room !== socket.id) socket.leave(room);
    });

    socket.join(channel);
    console.log(`유저[${socket.id}]가 [${channel}] 채널로 이동했습니다.`);

    // 해당 채널의 과거 대화 불러오기
    sendChannelHistory(socket, channel);
  });

  // 🟢 2. 실시간 메시지 수신 및 DB 저장
  socket.on('chat message', async (data) => {
    const channel = data.channel || 'general';

    const messageData = {
      channel: channel,
      nickname: data.nickname || '익명',
      text: data.text,
      time: data.time,
      fullDate: data.fullDate,
      senderId: socket.id, // 보낸 사람 소켓 ID 저장 (익명 구분을 위함)
      timestamp: admin.firestore.FieldValue.serverTimestamp() // 정렬용 서버 시각
    };

    try {
      // Firebase Firestore에 저장 (서버가 리부팅되어도 유지됨)
      const docRef = await db.collection('messages').add(messageData);

      // 해당 채널에 접속 중인 모든 사람에게 실시간 전파
      io.to(channel).emit('chat message', {
        id: docRef.id,
        ...data,
        senderId: socket.id
      });
    } catch (error) {
      console.error('메시지 DB 저장 오류:', error);
    }
  });

  socket.on('disconnect', () => {
    console.log('유저 접속 종료:', socket.id);
  });
});

// Render 클라우드용 자동 포트 감지 (기본 3000번)
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`서버가 http://localhost:${PORT} 에서 정상 작동 중입니다.`);
});
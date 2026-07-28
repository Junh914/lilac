const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const admin = require('firebase-admin');
const path = require('path');

// Render 환경 변수에서 Firebase Admin 인증 정보 읽어오기
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 정적 파일 제공 (루트 디렉토리 기준)
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 🟢 3개월이 초과된 오래된 메시지 자동 삭제 및 청소 함수
async function cleanupOldMessages() {
  try {
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    const snapshot = await db.collection('messages')
      .where('timestamp', '<', admin.firestore.Timestamp.fromDate(threeMonthsAgo))
      .get();

    if (snapshot.empty) return;

    const batch = db.batch();
    snapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });
    
    await batch.commit();
    console.log(`🧹 3개월이 지난 오래된 메시지 ${snapshot.size}개를 삭제했습니다.`);
  } catch (error) {
    console.error('오래된 메시지 삭제 중 오류 발생:', error);
  }
}

// 서버 실행 시 및 24시간마다 오래된 메시지 정리 실행
cleanupOldMessages();
setInterval(cleanupOldMessages, 24 * 60 * 60 * 1000);

// 🟢 DB에서 '최근 3개월 이내'의 메시지만 불러와서 클라이언트에 전달하는 함수
async function sendChannelHistory(socket, channel) {
  try {
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    const snapshot = await db.collection('messages')
      .where('channel', '==', channel)
      .where('timestamp', '>=', admin.firestore.Timestamp.fromDate(threeMonthsAgo))
      .orderBy('timestamp', 'asc')
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

io.on('connection', (socket) => {
  console.log('유저 접속 완료:', socket.id);

  socket.on('join channel', (channel) => {
    socket.rooms.forEach((room) => {
      if (room !== socket.id) socket.leave(room);
    });

    socket.join(channel);
    console.log(`유저[${socket.id}]가 [${channel}] 채널에 접속했습니다.`);

    // 접속 시 최근 3개월 이내의 채팅 내역 전송
    sendChannelHistory(socket, channel);
  });

  socket.on('chat message', async (data) => {
    const channel = data.channel || 'general';

    const messageData = {
      channel: channel,
      uid: data.uid,
      nickname: data.nickname || '익명',
      text: data.text,
      time: data.time,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    };

    try {
      // Cloud Firestore에 메시지 저장
      await db.collection('messages').add(messageData);
      // 같은 채널의 모든 유저에게 실시간 브로드캐스트
      io.to(channel).emit('chat message', messageData);
    } catch (error) {
      console.error('메시지 저장 실패:', error);
    }
  });

  socket.on('disconnect', () => {
    console.log('유저 연결 해제:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 서버가 포트 ${PORT}에서 정상 실행 중입니다.`);
});
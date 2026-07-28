const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const admin = require('firebase-admin');
const path = require('path');

// 1. Firebase Admin 초기화 (중복 방지 안전장치 포함)
if (!admin.apps.length) {
  // Render 환경 변수에 등록해 둔 FIREBASE_SERVICE_ACCOUNT 사용
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}
const db = admin.firestore();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// 정적 파일 제공 (루트 폴더)
app.use(express.static(__dirname));

// 2. 3개월이 지난 오래된 데이터 매일 자동 삭제 (요금 폭탄 방지)
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
    console.log(`🧹 3개월 경과된 오래된 메시지 ${snapshot.size}개 삭제 완료`);
  } catch (error) {
    console.error('오래된 메시지 삭제 중 오류:', error);
  }
}
setInterval(cleanupOldMessages, 24 * 60 * 60 * 1000); // 24시간마다 실행

// 3. 소켓 통신 로직
io.on('connection', (socket) => {
  console.log('유저 접속 완료:', socket.id);

  // 채널(자유채팅방) 입장 시 과거 3개월 내역 전송
  socket.on('join channel', async (channel) => {
    socket.join(channel);
    
    try {
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

      // Firestore에서 최근 3개월 메시지 시간순으로 불러오기
      const snapshot = await db.collection('messages')
        .where('channel', '==', channel)
        .where('timestamp', '>=', admin.firestore.Timestamp.fromDate(threeMonthsAgo))
        .orderBy('timestamp', 'asc')
        .get();

      const history = [];
      snapshot.forEach((doc) => history.push(doc.data()));

      // 접속한 클라이언트에게 대화 내역 전달
      socket.emit('chat history', { history });
    } catch (error) {
      console.error(`DB 대화 내역 불러오기 실패:`, error);
    }
  });

  // 새 메시지 수신 및 브로드캐스트 + DB 영구 저장
  socket.on('chat message', async (data) => {
    // 타임스탬프를 포함하여 DB 저장용 객체 생성
    const messageData = {
      channel: data.channel,
      uid: data.uid,
      nickname: data.nickname,
      text: data.text,
      date: data.date,
      time: data.time,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    };

    // 실시간 통신 딜레이 방지를 위해 클라이언트들에게 즉시 뿌려줌
    io.to(data.channel).emit('chat message', messageData);

    // 비동기로 Firestore DB에 영구 저장 (서버가 리셋되어도 보존됨)
    try {
      await db.collection('messages').add(messageData);
    } catch (err) {
      console.error('메시지 DB 저장 실패:', err);
    }
  });
});

// Render 동적 포트 대응
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 서버가 포트 ${PORT}에서 실행 중입니다.`);
});
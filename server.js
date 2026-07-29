const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const admin = require('firebase-admin');

// 1. Firebase Admin 초기화 (중복 방지 안전장치)
if (!admin.apps.length) {
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

// 2. 소켓 통신 로직
io.on('connection', (socket) => {
  console.log('유저 접속 완료:', socket.id);

  // 채널(자유채팅방) 입장 시 전체 과거 대화 불러오기
  socket.on('join channel', async (channel) => {
    socket.join(channel);
    
    try {
      // Firestore에서 해당 채널 메시지 수집 (인덱스 에러 방지를 위해 서버 메모리 정렬 처리)
      const snapshot = await db.collection('messages').get();
      let history = [];

      snapshot.forEach((doc) => {
        const data = doc.data();
        if (data.channel === channel) {
          history.push(data);
        }
      });

      // 타임스탬프 기준 오름차순(과거 -> 최신) 정렬
      history.sort((a, b) => {
        const timeA = a.timestamp ? (a.timestamp._seconds || new Date(a.timestamp).getTime() / 1000) : 0;
        const timeB = b.timestamp ? (b.timestamp._seconds || new Date(b.timestamp).getTime() / 1000) : 0;
        return timeA - timeB;
      });

      // 접속한 클라이언트에게 정렬된 대화 내역 전달
      socket.emit('chat history', { history });
    } catch (error) {
      console.error('DB 대화 내역 불러오기 실패:', error);
    }
  });

  // 새 메시지 수신 및 실시간 브로드캐스트 + DB 영구 저장
  socket.on('chat message', async (data) => {
    const messageData = {
      channel: data.channel || 'general',
      uid: data.uid,
      nickname: data.nickname,
      photoURL: data.photoURL || null,
      text: data.text,
      date: data.date,
      time: data.time,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    };

    // 실시간 클라이언트 전송
    io.to(messageData.channel).emit('chat message', messageData);

    // Firestore DB 영구 저장
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
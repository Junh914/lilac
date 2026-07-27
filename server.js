const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const admin = require('firebase-admin');
const path = require('path');

// 1. Firebase Admin SDK 연결
const serviceAccount = require('./firebase-key.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// public 폴더 내 정적 파일 제공
app.use(express.static(path.join(__dirname, 'public')));

// 🟢 [기능 추가] 3개월이 초과된 오래된 메시지 자동 삭제 (DB 영구저장 한도)
async function cleanupOldMessages() {
  try {
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    // 3개월 이전 데이터 조회
    const snapshot = await db.collection('messages')
      .where('timestamp', '<', admin.firestore.Timestamp.fromDate(threeMonthsAgo))
      .get();

    if (snapshot.empty) return;

    // 일괄 삭제 (Batch Delete)
    const batch = db.batch();
    snapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });
    
    await batch.commit();
    console.log(`🧹 3개월이 초과된 오래된 메시지 ${snapshot.size}개를 삭제했습니다.`);
  } catch (error) {
    console.error('오래된 메시지 삭제 중 오류 발생:', error);
  }
}

// 서버 실행 시 1회 청소 진행 후, 24시간마다 반복 실행되도록 예약
cleanupOldMessages();
setInterval(cleanupOldMessages, 24 * 60 * 60 * 1000); // 24시간


// 🟢 Firestore에서 해당 채널의 '최근 3개월' 대화 내역만 읽어오는 함수
async function sendChannelHistory(socket, channel) {
  try {
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    // 최근 3개월 데이터만 생성 시간순으로 오름차순 정렬하여 불러오기
    const snapshot = await db.collection('messages')
      .where('channel', '==', channel)
      .where('timestamp', '>=', admin.firestore.Timestamp.fromDate(threeMonthsAgo))
      .orderBy('timestamp', 'asc')
      .get();

    const history = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        channel: data.channel,
        uid: data.uid,
        nickname: data.nickname,
        profileImg: data.profileImg,
        text: data.text,
        time: data.time,
        fullDate: data.fullDate,
        senderId: data.senderId
      };
    });

    socket.emit('chat history', { channel, history });
  } catch (error) {
    console.error(`[${channel}] 대화 내역 불러오기 실패:`, error);
    socket.emit('chat history', { channel, history: [] });
  }
}

io.on('connection', (socket) => {
  console.log('유저 접속 완료:', socket.id);

  // 🟢 1. 유저 채널 이동 및 대화 내역 요청
  // (Race Condition 방지를 위해 클라이언트가 '내 정보'를 확인한 직후 호출함)
  socket.on('join channel', (channel) => {
    socket.rooms.forEach((room) => {
      if (room !== socket.id) socket.leave(room);
    });

    socket.join(channel);
    console.log(`유저[${socket.id}]가 [${channel}] 채널로 이동했습니다.`);

    sendChannelHistory(socket, channel);
  });

  // 🟢 2. 실시간 메시지 수신 및 DB 저장
  socket.on('chat message', async (data) => {
    const channel = data.channel || 'general';

    const messageData = {
      channel: channel,
      uid: data.uid,
      nickname: data.nickname || '익명',
      profileImg: data.profileImg || null,
      text: data.text,
      time: data.time,
      fullDate: data.fullDate,
      senderId: socket.id,
      timestamp: admin.firestore.FieldValue.serverTimestamp() // 정렬용 서버 시각
    };

    try {
      const docRef = await db.collection('messages').add(messageData);

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

// 클라우드 호스팅용 자동 포트 감지
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
});
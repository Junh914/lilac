const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const admin = require('firebase-admin');
const path = require('path');

// ✅ 1. Firebase Admin SDK 연결 (Render 환경 변수 사용 방식)
// 보안을 위해 firebase-key.json 파일을 직접 불러오지 않고, 
// Render에 등록한 환경 변수에서 JSON 문자열을 가져와 파싱합니다.
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// public 폴더 내 정적 파일 제공
app.use(express.static(path.join(__dirname, 'public')));

// 🟢 [기능 1] 3개월이 초과된 오래된 메시지 자동 삭제 (DB 영구저장 한도)
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
setInterval(cleanupOldMessages, 24 * 60 * 60 * 1000); // 24시간마다 실행


// 🟢 [기능 2] Firestore에서 해당 채널의 '최근 3개월' 대화 내역만 읽어오는 함수
async function sendChannelHistory(socket, channel) {
  try {
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    // 최근 3개월 데이터만 생성 시간순
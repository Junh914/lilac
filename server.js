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

// 필수 미들웨어: JSON 데이터 파싱 및 정적 파일 제공
app.use(express.json());
app.use(express.static(__dirname));

// 2. 회원가입 API 라우트
app.post('/signup', async (req, res) => {
  try {
    const { email, password, nickname } = req.body;
    if (!email || !password || !nickname) {
      return res.status(400).json({ message: '모든 필드를 입력해주세요.' });
    }

    const userRef = db.collection('users').doc(email);
    const doc = await userRef.get();
    if (doc.exists) {
      return res.status(400).json({ message: '이미 존재하는 이메일입니다.' });
    }

    const userData = { email, password, nickname, uid: email };
    await userRef.set(userData);

    res.status(200).json({ user: { uid: email, nickname, email } });
  } catch (error) {
    console.error('회원가입 에러:', error);
    res.status(500).json({ message: '서버 내부 오류가 발생했습니다.' });
  }
});

// 3. 로그인 API 라우트
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: '이메일과 비밀번호를 입력해주세요.' });
    }

    const userRef = db.collection('users').doc(email);
    const doc = await userRef.get();
    if (!doc.exists) {
      return res.status(400).json({ message: '존재하지 않는 사용자입니다.' });
    }

    const userData = doc.data();
    if (userData.password !== password) {
      return res.status(400).json({ message: '비밀번호가 일치하지 않습니다.' });
    }

    res.status(200).json({ user: { uid: userData.uid, nickname: userData.nickname, email: userData.email } });
  } catch (error) {
    console.error('로그인 에러:', error);
    res.status(500).json({ message: '서버 내부 오류가 발생했습니다.' });
  }
});

// 4. 소켓 통신 로직
io.on('connection', (socket) => {
  console.log('유저 접속 완료:', socket.id);

  // 채널 입장 시 전체 과거 대화 불러오기
  socket.on('join channel', async (channel) => {
    socket.join(channel);
    
    try {
      const snapshot = await db.collection('messages').get();
      let history = [];

      snapshot.forEach((doc) => {
        const data = doc.data();
        if (data.channel === channel) {
          history.push(data);
        }
      });

      history.sort((a, b) => {
        const timeA = a.timestamp ? (a.timestamp._seconds || new Date(a.timestamp).getTime() / 1000) : 0;
        const timeB = b.timestamp ? (b.timestamp._seconds || new Date(b.timestamp).getTime() / 1000) : 0;
        return timeA - timeB;
      });

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
      text: data.text,
      date: data.date,
      time: data.time,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    };

    try {
      await db.collection('messages').add(messageData);
      io.to(messageData.channel).emit('chat message', messageData);
    } catch (error) {
      console.error('메시지 저장 실패:', error);
    }
  });

  socket.on('disconnect', () => {
    console.log('유저 접속 종료:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
});
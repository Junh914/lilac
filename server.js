const express = require('express');
const http = require('http'); // ⭕ 수정 완료
const { Server } = require('socket.io');
const admin = require('firebase-admin');

//참고: 파이어베이스 Admin SDK를 사용하려면 아래 주석을 풀고 serviceAccountKey.json 파일을 서버 폴더에 넣어야 합니다.
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 접속 중인 사용자들의 FCM 푸시 토큰 저장소
const userTokens = new Map();

// [단일 웹페이지 제공] 루트 경로 접속 시 채팅 화면 바로 렌더링
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="ko">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>실시간 채팅 및 시스템 알림</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; max-width: 600px; }
        #chat-box { width: 100%; height: 300px; border: 1px solid #ccc; overflow-y: scroll; padding: 10px; margin-bottom: 10px; background: #fafafa; }
        input { padding: 10px; width: 75%; box-sizing: border-box; }
        button { padding: 10px 15px; }
        .guide { font-size: 12px; color: #555; background: #eee; padding: 8px; margin-bottom: 10px; border-radius: 4px; }
      </style>
    </head>
    <body>

      <h2>Lilac</h2>
      <div class="guide">
        💡 <b>Windows</b>는 브라우저 알림 권한 허용, <b>iOS 크롬</b>은 [홈 화면에 추가] 후 실행해야 시스템 알림이 정상 작동합니다.
      </div>

      <div id="chat-box"></div>
      <input type="text" id="message-input" placeholder="메시지를 입력하세요...">
      <button onclick="sendMessage()">전송</button>

      <script src="/socket.io/socket.io.js"></script>
      <script src="https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js"></script>
      <script src="https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js"></script>

      <script>
        const socket = io();
        const userName = "유저_" + Math.floor(Math.random() * 1000);

        // 1. Windows 및 iOS 크롬 등 기기 자체 알림 권한 요청
        if (window.Notification) {
          Notification.requestPermission().then((permission) => {
            if (permission === 'granted') {
              console.log('알림 권한이 허용되었습니다.');
            }
          });
        }

        // 2. 파이어베이스 웹 설정 (본인의 파이어베이스 콘솔 값 입력)
        const firebaseConfig = {
  apiKey: "AIzaSyDRGQYScMifqnzBGvN8UfVx_mmHJL4MhPg",
  authDomain: "lilac-13935.firebaseapp.com",
  projectId: "lilac-13935",
  storageBucket: "lilac-13935.firebasestorage.app",
  messagingSenderId: "485552650048",
  appId: "1:485552650048:web:d05c5dd6ce989765a5aca5",
  measurementId: "G-81H89P6F6E"
};

        if (firebase.apps.length === 0) {
          firebase.initializeApp(firebaseConfig);
        }
        
        const messaging = firebase.messaging();

        // FCM 토큰 발급 및 서버 전달 (VAPID 키 입력 필요)
        messaging.getToken({ vapidKey: 'YOUR_VAPID_KEY' })
          .then((currentToken) => {
            if (currentToken) {
              console.log('FCM 토큰 발급 완료:', currentToken);
              socket.emit('register-fcm-token', currentToken);
            }
          })
          .catch((err) => {
            console.log('FCM 토큰 발급 실패 (지원 환경 확인 필요):', err);
          });

        // 포그라운드 상태에서 FCM 메시지 수신 시 알림 팝업 띄우기
        messaging.onMessage((payload) => {
          console.log('포그라운드 FCM 메시지 수신:', payload);
          if (Notification.permission === 'granted') {
            new Notification(payload.notification.title, {
              body: payload.notification.body
            });
          }
        });

        // 3. 실시간 채팅 메시지 수신
        socket.on('new-message', (data) => {
          const chatBox = document.getElementById('chat-box');
          chatBox.innerHTML += \`<div><b>\${data.sender}</b>: \${data.message}</div>\`;
          chatBox.scrollTop = chatBox.scrollHeight;

          // 앱이 백그라운드에 있거나 포커스가 안 되어 있을 때 시스템 알림 표시
          if (data.sender !== userName && document.hidden && Notification.permission === 'granted') {
            new Notification(data.sender, {
              body: data.message
            });
          }
        });

        // 메시지 전송 함수
        function sendMessage() {
          const input = document.getElementById('message-input');
          if (!input.value.trim()) return;

          socket.emit('send-message', {
            sender: userName,
            message: input.value
          });
          input.value = '';
        }

        document.getElementById('message-input').addEventListener('keypress', (e) => {
          if (e.key === 'Enter') sendMessage();
        });
      </script>
    </body>
    </html>
  `);
});

// 소켓 서버 통신 처리
io.on('connection', (socket) => {
  console.log('사용자 연결됨:', socket.id);

  socket.on('register-fcm-token', (token) => {
    userTokens.set(socket.id, token);
  });

  socket.on('send-message', (data) => {
    console.log(`[${data.sender}]: ${data.message}`);
    
    // 1. 모든 접속자에게 실시간 채팅 데이터 전달
    io.emit('new-message', data);

    // 2. 다른 기기(Windows 또는 iOS 크롬 백그라운드 등)로 FCM 푸시 전송
    userTokens.forEach((token, sId) => {
      if (sId !== socket.id) {
        const payload = {
          token: token,
          notification: {
            title: `${data.sender}`,
            body: data.message
          }
        };

        if (admin.apps.length > 0) {
          admin.messaging().send(payload)
            .catch((error) => console.error('FCM 전송 오류:', error));
        }
      }
    });
  });

  socket.on('disconnect', () => {
    userTokens.delete(socket.id);
    console.log('사용자 연결 해제:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
});
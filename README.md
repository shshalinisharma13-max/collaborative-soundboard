# Collaborative Soundboard

A small real-time soundboard for 4–5 computers. Each browser generates its own
sounds with Tone.js; Socket.IO only sends the pad events.

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:3000/?room=test` on several browser tabs or computers on
the same network.

For testing from another device on your local network, use your computer's local
IP address, for example:

```text
http://192.168.1.20:3000/?room=test
```

You may need to allow Node.js through your firewall.

## Put it on GitHub

```bash
git init
git add .
git commit -m "Initial collaborative soundboard"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/collaborative-soundboard.git
git push -u origin main
```

## Deploy on Render

1. Create a new **Web Service**.
2. Connect this GitHub repository.
3. Build command: `npm install`
4. Start command: `npm start`
5. Deploy.

Render supplies the `PORT` environment variable automatically. The app already
uses it.

Share the resulting public URL with a room query, for example:

```text
https://YOUR-APP.onrender.com/?room=india-uk
```

Every participant must press **Start audio & join** once because browsers do not
permit web audio to begin automatically.

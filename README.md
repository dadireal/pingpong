# PingPong Online 🏓

A real-time multiplayer ping pong game — play in the browser with friends, no account needed.

**[▶ Play Now](https://dadireal.github.io/pingpong)**

## How to Play

1. **Host** opens the game → shares their **Room ID** with a friend
2. **Friend** enters the Room ID on the Join tab → game starts instantly!
3. First to **7 points** wins 🏆

### Controls
| Key | Action |
|-----|--------|
| `↑` / `W` | Move paddle up |
| `↓` / `S` | Move paddle down |

## How it Works

- **No server needed** — uses [PeerJS](https://peerjs.com/) for browser-to-browser (WebRTC) connections
- The **Host** runs the physics simulation and sends the game state to the guest each frame
- The **Guest** sends only their input (paddle direction) back to the host

## Deploy to GitHub Pages

1. Push this repo to GitHub
2. Go to **Settings → Pages**
3. Set source to **Deploy from a branch → main → / (root)**
4. Done! Your game is live at `https://YOUR-USERNAME.github.io/REPO-NAME`

## Files

| File | Description |
|------|-------------|
| `index.html` | Game structure and lobby UI |
| `style.css`  | Dark glassmorphism design |
| `game.js`    | P2P multiplayer logic + game physics |

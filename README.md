# Snowball Toss

A multiplayer two-screen game: the computer shows the targets, and up to four phones join as color-coded snowball controllers. The board uses `public/game-background.png`, the launcher uses `public/snowball.png`, and `public/penguin-walk.gif` animates the penguin as it walks across the snow and flips direction at each edge. Players can hit the penguin or the airborne `public/air-target.png`; either target explodes before reappearing.

## Run it locally

1. Install Node.js if it is not already installed.
2. From this folder, run `node server.js` (or `npm start`).
3. Open one of the `http://...` LAN addresses printed by the server on the computer.
4. On the computer, choose **I'm on the computer**. On each phone, open that same address and choose **I'm on the phone**.
5. Enter the room code shown under the computer's target, or scan its QR code. Each phone gets a color in join order: red, blue, green, then yellow.
6. On each phone, drag from the snowball at the bottom toward the walking penguin or airborne bullseye and release. The computer shows each player's score separately.

The room is held in server memory and lasts until the server stops.

## Deploy to Render

The included `render.yaml` configures a free Render web service. To deploy:

1. Push this project to a GitHub repository.
2. In Render, choose **New → Blueprint**, connect that repository, and deploy the `render.yaml` blueprint.
3. Open the Render URL on the computer and start a game.
4. Scan the QR code under the target with each phone camera. Phones join that game automatically; the room code is also available for manual joining. Up to four phones can play, each with a separate score.

Both devices need an internet connection, but they do not need to be on the same Wi-Fi. Room state is kept in server memory, so a service restart ends active games.

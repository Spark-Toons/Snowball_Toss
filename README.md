# Snowball Toss

A two-screen game: the computer shows the target, and a phone on the same Wi-Fi acts as the snowball controller.

## Run it locally

1. Install Node.js if it is not already installed.
2. From this folder, run `node server.js` (or `npm start`).
3. Open one of the `http://...` LAN addresses printed by the server on the computer.
4. On the computer, choose **I'm on the computer**. On the phone, open that same LAN address and choose **I'm on the phone**.
5. Enter the room code shown under the computer's target.
6. On the phone, drag from the snowball at the bottom toward the target and release.

The room is held in server memory and lasts until the server stops.

## Deploy to Render

The included `render.yaml` configures a free Render web service. To deploy:

1. Push this project to a GitHub repository.
2. In Render, choose **New → Blueprint**, connect that repository, and deploy the `render.yaml` blueprint.
3. Open the Render URL on the computer and start a game.
4. Scan the QR code under the target with the phone camera. The phone joins that game automatically; the room code is also available for manual joining.

Both devices need an internet connection, but they do not need to be on the same Wi-Fi. Room state is kept in server memory, so a service restart ends active games.

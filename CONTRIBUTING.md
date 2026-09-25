# Contributing

Work from a Command Prompt in the repo folder.

```
git clone https://github.com/sreyand/sydtrack.git
cd sydtrack
npm install
npm start
```

Day to day: `git pull` then `npm start`. Run `npm install` again only when `package-lock.json` changed.

```
npm test
```

If `npm start` says the Electron binary is missing, run `npm install` from this folder. That is enough; do not use `npm install-scripts approve` as a standing setup step.

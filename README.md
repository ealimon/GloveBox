# 🛠 GloveBox | Professional Car Maintenance Tracker

**GloveBox** is a privacy-first mobile app designed by **Limon Media**. It tracks service history across multiple cars with zero data tracking, zero accounts, and zero latency.

## 🌟 Key Features
- **Privacy-First:** Data is stored locally on your device. It never touches a server.
- **Multi-Vehicle Support:** Tag entries by car nickname, filter history per car.
- **Service Reminders:** "Every 5,000 mi / 6 months" per car and service. Date-based reminders send a local notification (iOS app); mileage-based ones show in the app.
- **Cost & Notes:** Track what each service cost and where it was done, with totals per car.
- **Edit Entries**, "miles since last service" counters, and a per-car current-mileage update.
- **Backup & Restore:** Save a JSON backup, restore by merging or replacing.
- **CSV Export:** Full history for insurance or resale.
- **Miles or Kilometers.**
- **PWA Ready:** Manifest and offline service worker for "Add to Home Screen".

## 🛠 Development
- **Stack:** Vanilla JavaScript, Tailwind CSS 3 (compiled locally), Capacitor 6 for iOS
- **Storage:** Browser LocalStorage (key `glovebox_v2`; v1.0 data in `carLogs` is migrated automatically and left in place)

```bash
npm install
npm run build        # compiles Tailwind -> www/styles.css (re-run after changing classes)
npx http-server www  # preview in a browser
```

## 📱 Releasing to the App Store
1. Bump `"version"` in `package.json` (it becomes the App Store version; must be higher than the live one).
2. Push to GitHub, then run the **Build & Upload to App Store Connect** workflow (Actions tab).
3. Once the build finishes processing in App Store Connect (TestFlight), create the new version, select the build, add "What's New", and submit for review.

## 🔒 Privacy
No accounts, no analytics, no ads, no network calls. All data stays on the device unless the user exports it.

---
Designed with ❤️ by [Limon Media](https://www.Limon.Media)

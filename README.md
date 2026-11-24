# CampusBite
Food, nutrition and spending tracker for RVCE students (170 foods from the nutrition spreadsheet).

## Run
1. Install Node.js (v18+)
2. In this folder: `npm install` then `npm start`
3. Open http://localhost:3000 and register an account

Optional real AI: set ANTHROPIC_API_KEY before `npm start` (PowerShell: `$env:ANTHROPIC_API_KEY="your-key"`).
Without it, the AI page uses simple keyword rules on your own data.

## Files
- server.js     backend: database tables, login, API routes, AI
- data/foods.json  nutrition data from the spreadsheet (loaded into SQLite once)
- public/       frontend: index.html (structure), style.css (look), app.js (behaviour)

## Tech stack
Node.js · Express · SQLite (better-sqlite3) · JWT + bcrypt login · REST API · vanilla JS · Chart.js


## Nutrition and wellbeing updates
- Expense totals and charts use prices entered when logging Mini Mingos purchases. Hostel Mess is treated as free; enter the actual amount paid for paid purchases.
- Calories are displayed as an estimate with a default ±15% range to acknowledge portion and preparation differences.
- The Nutrition & wellbeing page provides a rough, non-medical 1–5 food-balance guide, optional BMI calculation, gentle variety reminders, and a link to ICMR–NIN's Dietary Guidelines for Indians (2024).
- BMI is not used to calculate a personal calorie target. The app's food-balance score is a heuristic, not a medical or dietitian assessment.
- Height and weight entered in the optional BMI calculator are saved in this browser's localStorage, not in the SQLite database.

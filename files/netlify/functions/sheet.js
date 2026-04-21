// ================================================================
// Netlify Serverless Function — sheet.js
// ----------------------------------------------------------------
// This runs on Netlify's servers (not in the browser), so it can
// fetch your Google Sheet without any CORS issues.
//
// The website calls /api/sheet → this function fetches the CSV
// from Google Sheets and returns it to the browser.
// ================================================================

const SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSDFNTENnTQYHsKFMie3oWgbB7fKObYJeMHJdkYcXvTdGe54bCb3Ydx9Ss_RQkS0Gd3Bi0K78qzKm9n/pub?gid=0&single=true&output=csv";

exports.handler = async function(event, context) {
  try {
    const response = await fetch(SHEET_URL);
    const csv = await response.text();

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "text/plain",
        "Access-Control-Allow-Origin": "*",
      },
      body: csv,
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};

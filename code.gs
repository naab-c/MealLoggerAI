// --------------------------
// Configuration
// --------------------------
const OPENAI_API_KEY = "xxxxxx";
const SHEET_OWNER_EMAIL = "xxxxxx"; // Receives registration requests

// Map of approved users to their spreadsheet tab names
const USER_TABS = {
  "xxxxxx"
};

// --------------------------
// Helper: Get last usage summary for a user
// --------------------------
function getUsageSummary(user) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const usageSheet = ss.getSheetByName("Usage");
  if (!usageSheet) return null;

  const values = usageSheet.getDataRange().getValues();
  if (values.length <= 1) return null; // no data except header

  const userRows = values.filter(r => r[1] === user);
  if (userRows.length === 0) return null;

  const last = userRows[userRows.length - 1];
  return {
    date: last[0],
    inputTokens: last[2],
    outputTokens: last[3],
    totalTokens: last[4],
    totalCost: last[5]
  };
}

/**
 * Appends a new meal block to the user’s sheet.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - The user’s sheet.
 * @param {Array<Object>} tableLines - Array of row objects { Component, Calories, Protein, Carbs, Fat }.
 * @param {Object} totals - Object with { Calories, Protein, Carbs, Fat }.
 * @param {string} summary - Summary string from model.
 * @param {string} ts - Timestamp string for header.
 */
function writeMealBlock(sheet, tableLines, totals, summary, ts) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);

  try {
    const lastRow = sheet.getLastRow();
    const isFirstMeal = lastRow === 1; // only header row exists

    // If not first meal, insert 2 blank spacer rows
    if (!isFirstMeal) {
      sheet.insertRowsAfter(lastRow, 2);
    }

    // Row where new meal header goes
    const headerRow = isFirstMeal ? 2 : lastRow + 3;

    // Meal header
    sheet.getRange(headerRow, 1).setValue("Meal logged on " + ts);
    sheet.getRange(headerRow, 1, 1, 6)
      .merge()
      .setBackground("yellow")
      .setHorizontalAlignment("center")
      .setFontWeight("bold")
      .setFontColor("black")
      .setFontStyle("normal");

    // Table rows
    let writeRow = headerRow + 1;
    if (tableLines.length > 0) {
      const tableValues = tableLines.map(r => [
        r.Component, r.Calories, r.Protein, r.Carbs, r.Fat
      ]);
      sheet.getRange(writeRow, 1, tableValues.length, 5)
        .setValues(tableValues)
        .setFontColor("black")
        .setFontStyle("normal")
        .setFontWeight("normal")
        .setHorizontalAlignment("center")
        .setBackground(null);
      writeRow += tableValues.length;
    }

    // Totals
    if (totals && Object.keys(totals).length > 0) {
      sheet.getRange(writeRow, 1, 1, 5)
        .setValues([["Total", totals.Calories, totals.Protein, totals.Carbs, totals.Fat]])
        .setFontColor("black")
        .setFontStyle("normal")
        .setFontWeight("bold")
        .setHorizontalAlignment("center")
        .setBackground(null);
      writeRow += 1;
    }

    // Summary
    if (summary) {
      const summaryFormatted =
        "Summary (Totals) - " +
        summary.replace(/Calories:/, "Calories:")
               .replace(/Protein:/, "Protein:")
               .replace(/Carbs:/, "Carbs:")
               .replace(/Fat:/, "Fat:");

      sheet.getRange(writeRow, 1).setValue(summaryFormatted);
      sheet.getRange(writeRow, 1, 1, 6)
        .merge()
        .setHorizontalAlignment("center")
        .setFontWeight("bold")
        .setFontColor("#A52A2A")
        .setFontStyle("italic")
        .setBackground(null);
      writeRow += 1;
    }

  } finally {
    lock.releaseLock();
  }
}

function doPost(e) {
  // --- Require token on all requests ---
  const PROPS = PropertiesService.getScriptProperties();
  const EXPECTED = PROPS.getProperty("API_TOKEN");
  const token = (e && e.parameter && e.parameter.t) ? e.parameter.t : "";

  if (!EXPECTED || token !== EXPECTED) {
    return ContentService.createTextOutput(JSON.stringify({ error: "Unauthorized" }))
    .setMimeType(ContentService.MimeType.JSON);
  }

  try {
    // Accept both text/plain (no preflight) and application/json
    const raw = (e && e.postData && e.postData.contents) ? e.postData.contents : "{}";
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (err) {
      return ContentService.createTextOutput(JSON.stringify({ error: "Invalid JSON body" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const user = (payload.user || "").toLowerCase();
    const meal = payload.meal;
    const username = payload.username; // only for registration

    // --------------------------
    // Registration request
    // --------------------------
    if (payload.register) {
      if (!user || !username) throw new Error("Username and email required for registration");

      MailApp.sendEmail({
        to: SHEET_OWNER_EMAIL,
        subject: "New Meal Logger Registration Request",
        htmlBody:
          "<p>New user registration request received:</p>" +
          "<ul>" +
          "<li>Username (tab name): " + username + "</li>" +
          "<li>Email: " + user + "</li>" +
          "</ul>" +
          "<p>Please create a new tab and add to USER_TABS to approve.</p>"
      });

      // ✅ Only one return
      return ContentService.createTextOutput(JSON.stringify({ success: true }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // --------------------------
    // Meal submission
    // --------------------------
    if (!meal) throw new Error("Meal is required");

    // Basic validation
    if (meal.length < 3 || !/[a-zA-Z]/.test(meal) || !/\d/.test(meal)) {
      return ContentService.createTextOutput(JSON.stringify({
        error: "Invalid meal input. Please include food name and quantity (e.g. '2 eggs, 1 apple')."
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // Validate user
    const sheetName = USER_TABS[user];
    if (!sheetName) throw new Error("Unauthorized user");

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) throw new Error("Sheet tab not found for user: " + user);

    // --------------------------
    // Call OpenAI for breakdown (JSON output guaranteed)
    // --------------------------
    const response = UrlFetchApp.fetch("https://api.openai.com/v1/chat/completions", {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + OPENAI_API_KEY },
      payload: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `
You are a nutrition assistant.
Output strictly in JSON with this format:
{
  "table": [
    { "Component": "Egg (1)", "Calories": 70, "Protein": 6, "Carbs": 0.5, "Fat": 5 }
  ],
  "total": { "Calories": 70, "Protein": 6, "Carbs": 0.5, "Fat": 5 },
  "summary": "Calories: 70 kcal, Protein: 6 g, Carbs: 0.5 g, Fat: 5 g"
}
Only output valid JSON. No markdown, no tables, no text outside JSON.`
          },
          { role: "user", content: "Give nutrient breakdown for: " + meal }
        ],
        temperature: 0
      }),
      muteHttpExceptions: true
    });

    const json = JSON.parse(response.getContentText());
    if (json.error) {
      return ContentService.createTextOutput(JSON.stringify({ error: "OpenAI API error: " + json.error.message }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const nutrition = JSON.parse(json.choices[0].message.content);
    const tableLines = nutrition.table || [];
    const totals     = nutrition.total || {};
    const summary    = nutrition.summary || "";

    // Usage logging
    var inputTokens  = json.usage ? json.usage.prompt_tokens     : 0;
    var outputTokens = json.usage ? json.usage.completion_tokens : 0;
    var totalTokens  = inputTokens + outputTokens;
    var totalCost    = (inputTokens/1e6)*0.15 + (outputTokens/1e6)*0.60;

    var usageSheet = ss.getSheetByName("Usage") || ss.insertSheet("Usage");
    usageSheet.appendRow([new Date(), user, inputTokens, outputTokens, totalTokens, totalCost]);

    // Append to sheet (you already have writeMealBlock)
    const ts = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), "yyyy-MM-dd HH:mm:ss");
    writeMealBlock(sheet, tableLines, totals, summary, ts);

    const usage = getUsageSummary(user);
    return ContentService.createTextOutput(JSON.stringify({
      meal: meal,
      table: tableLines || [],
      totals: totals || {},
      summary: summary,
      usage: usage || {}
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ error: error.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}


// --------------------------
// GET: Read-only history for a user
// --------------------------
function doGet(e) {
  const PROPS = PropertiesService.getScriptProperties();
  const EXPECTED = PROPS.getProperty("API_TOKEN");
  const token = (e && e.parameter && e.parameter.t) ? e.parameter.t : "";

  if (!EXPECTED || token !== EXPECTED) {
    return ContentService.createTextOutput(JSON.stringify({ error: "Unauthorized" }))
    .setMimeType(ContentService.MimeType.JSON);
  }

  if (e.parameter.action === "status") {
    const authorized = !!USER_TABS[e.parameter.user];
    return ContentService.createTextOutput(JSON.stringify({ authorized }))
    .setMimeType(ContentService.MimeType.JSON);
  }
  
  try {
    const user = (e.parameter.user || "").toLowerCase();
    const sheetName = USER_TABS[user];
    if (!sheetName) throw new Error("Unauthorized user");

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) throw new Error(`Sheet tab not found for user: ${user}`);

    const values = sheet.getDataRange().getValues();

    return ContentService.createTextOutput(JSON.stringify({
      table: values
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ error: error.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

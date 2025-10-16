// --------------------------
// Configuration
// --------------------------
const WEB_APP_URL = "https://xxxxxx";

// ----------------------------
// Meal Logger Popup Script
// ----------------------------

// Cached user info
let userEmail = localStorage.getItem("userEmail");
let username = localStorage.getItem("username");

// DOM elements
const registrationDiv = document.getElementById("registrationDiv");
const mealDiv = document.getElementById("mealDiv");
const registerBtn = document.getElementById("registerBtn");
const registerMessage = document.getElementById("registerMessage");
const submitMealBtn = document.getElementById("submitMealBtn");
const viewMealsBtn = document.getElementById("viewMealsBtn");
const responseDiv = document.getElementById("responseDiv");
const mealHistoryDiv = document.getElementById("mealHistoryDiv");

// Show registration form if first-time
if (!userEmail || !username) {
  registrationDiv.style.display = "block";
} else {
  mealDiv.style.display = "block";
}

// ----------------------------
// Registration
// ----------------------------
// Register button listener
registerBtn.addEventListener("click", async () => {
  const emailInput = document.getElementById("emailInput").value.trim();
  const usernameInput = document.getElementById("usernameInput").value.trim();

  if (!emailInput || !usernameInput) {
    registerMessage.textContent = "Please enter both username and email.";
    return;
  }

  registerMessage.textContent = "Sending registration request...";

  try {
    const res = await fetch(WEB_APP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        register: true,
        user: emailInput,
        username: usernameInput
      })
    });

    const data = await res.json();

    if (data.success) {
      registerMessage.textContent =
        "✅ Registration request sent. You will be notified once approved.";
      localStorage.setItem("userEmail", emailInput);
      localStorage.setItem("username", usernameInput);
      registerBtn.disabled = true; // disable after successful request
    } else {
      registerMessage.textContent = "❌ Registration failed. Try again later.";
    }
  } catch (err) {
    registerMessage.textContent = "⚠️ Error sending registration request.";
    console.error(err);
  }
});

submitMealBtn.addEventListener("click", async () => {
  // Clear meal history whenever user submits a meal
  mealHistoryDiv.textContent = "";
  responseDiv.textContent = "";

  const mealText = document.getElementById("mealInput").value.trim();
  if (!mealText) {
    responseDiv.textContent = "Enter a meal first.";
    return;
  }

  responseDiv.textContent = "Submitting...";

  try {
    const res = await fetch(WEB_APP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: userEmail, meal: mealText })
    });

    const data = await res.json();

    if (data.error) {
      responseDiv.textContent = "❌ " + data.error;
    } else if (data.table && data.table.length > 0) {
      const usage = data.usage || {};
      responseDiv.innerHTML =
        `Meal submitted successfully.<br/>` +
        `Tokens used: ${usage.totalTokens || 0} (in: ${usage.inputTokens || 0}, out: ${usage.outputTokens || 0})<br/>` +
        `Cost: $${usage.totalCost?.toFixed(6) || "0.000000"}`;
      document.getElementById("mealInput").value = "";
    } else {
      responseDiv.textContent = "Meal submitted successfully (no breakdown table returned).";
    }
  } catch (err) {
    responseDiv.textContent = "Error submitting meal.";
    console.error(err);
  }
});


// ----------------------------
// View last 5 meals
// ----------------------------
viewMealsBtn.addEventListener("click", async () => {
  // Clear submit response whenever user checks history
  responseDiv.textContent = "";
  mealHistoryDiv.textContent = "Loading...";

  try {
    const res = await fetch(`${WEB_APP_URL}?user=${encodeURIComponent(userEmail)}`);
    const data = await res.json();

    // 🔹 Check for unauthorized
    if (data.error && data.error.toLowerCase().includes("unauthorized")) {
      mealHistoryDiv.textContent = "⚠️ You are not authorized yet. Please wait for approval.";
      return;
    }

    const rows = (data.table || []).filter(r => r.join("").trim() !== "");
    if (rows.length === 0) {
      mealHistoryDiv.textContent = "No meals logged yet.";
      return;
    }

    // Group rows into meals
    const meals = [];
    let currentMeal = null;
    rows.forEach(row => {
      if (row[0].startsWith("Meal logged on")) {
        if (currentMeal) meals.push(currentMeal);
        currentMeal = [row];
      } else if (currentMeal) {
        currentMeal.push(row);
      }
    });
    if (currentMeal) meals.push(currentMeal);

    const last5Meals = meals.slice(-5);

    // Render meals
    let html = "<h3>Last 5 meals:</h3>";
    last5Meals.forEach((mealRows, idx) => {
      html += `<div class="meal-block">Meal ${idx + 1}:<br/>`;

      mealRows.forEach(row => {
        const cleanRow = [...row];
        while (cleanRow.length && cleanRow[cleanRow.length - 1] === "") {
          cleanRow.pop();
        }
        const line = cleanRow.join(" | ");

        if (line.startsWith("Meal logged on")) {
          html += `<div>${line}</div><br/>`;
          html += `<div><b>Component | Calories | Protein | Carbs | Fat</b></div>`;
        } else if (line.toLowerCase().startsWith("summary")) {
          html += `<div class="summary-line">${line}</div>`;
        } else {
          html += `${line}<br/>`;
        }
      });

      html += "</div>";
    });

    mealHistoryDiv.innerHTML = html;
  } catch (err) {
    mealHistoryDiv.textContent = "Failed to load meal history.";
    console.error(err);
  }
});

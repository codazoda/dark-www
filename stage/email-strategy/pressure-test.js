(function () {
  "use strict";

  var STORAGE_KEY = "email-strategy-pressure-test-v1";

  function emptyData() {
    return {
      outcome: "",
      buyer: "",
      product: "",
      differentiation: "",
      price: 25,
      priceRationale: "",
      verdict: null
    };
  }

  function loadData() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyData();
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return emptyData();
      var fresh = emptyData();
      for (var key in fresh) {
        if (parsed[key] !== undefined) fresh[key] = parsed[key];
      }
      return fresh;
    } catch (e) {
      return emptyData();
    }
  }

  function saveData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  var data = loadData();

  function num(v) {
    var n = Number(v);
    return isNaN(n) ? 0 : n;
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function nl2br(s) {
    return escapeHtml(s).replace(/\n/g, "<br>");
  }

  // ---------- rendering ----------

  var app = document.getElementById("app");

  function renderQuestions() {
    var lowPrice = num(data.price) < 25;
    return (
      '<div class="card alt story-reminder">' +
        "<h1>Offer Pressure Test</h1>" +
        "<p>Before you spend six emails testing an offer, make sure you know what you're actually asking people to buy.</p>" +
      "</div>" +

      '<div class="card question-card">' +
        "<h2>1. What painful or desirable outcome is somebody actually paying for?</h2>" +
        '<p class="small-note">Don’t describe the topic. Describe what changes for the buyer. "Learn about LLMs" is a topic. What can they do, accomplish, avoid, understand, or experience after buying that they couldn’t before?</p>' +
        '<textarea class="big" id="outcome" name="outcome" placeholder="The buyer is paying to...">' + escapeHtml(data.outcome) + "</textarea>" +
      "</div>" +

      '<div class="card question-card">' +
        "<h2>2. Who has this problem?</h2>" +
        '<p class="small-note">Who would recognize this problem and care enough about solving it to spend money? You don’t need an elaborate customer avatar. Be specific enough that you can tell whether this person plausibly exists on your current list.</p>' +
        '<textarea class="big" id="buyer" name="buyer" placeholder="This is for someone who...">' + escapeHtml(data.buyer) + "</textarea>" +
      "</div>" +

      '<div class="card question-card">' +
        "<h2>3. What exactly do they receive?</h2>" +
        '<p class="small-note">Define the smallest product you would be happy to deliver even if only one person buys. Make the promise concrete enough that a buyer knows what they’re purchasing. If the product doesn’t exist yet, only promise something you are willing and able to deliver.</p>' +
        '<textarea class="big" id="product" name="product" placeholder="When they buy, they receive...">' + escapeHtml(data.product) + "</textarea>" +
      "</div>" +

      '<div class="card question-card">' +
        "<h2>4. Why would they buy yours?</h2>" +
        '<p class="small-note">Assume free information about this subject already exists. Why would someone pay for your version? Consider your approach, perspective, constraints, experience, simplicity, specificity, format, or the problem you solve differently. Don’t settle for "because mine is good."</p>' +
        '<textarea class="big" id="differentiation" name="differentiation" placeholder="They would choose this because...">' + escapeHtml(data.differentiation) + "</textarea>" +
      "</div>" +

      '<div class="card question-card">' +
        "<h2>5. Does the price make sense for the promise?</h2>" +
        '<label for="price">Proposed price</label>' +
        '<input type="number" id="price" name="price" min="0" step="1" value="' + escapeHtml(data.price) + '">' +
        (lowPrice
          ? '<p class="low-price-warning" id="price-warning"><strong>Volume warning:</strong> Lower prices require more buyers. Your current strategy favors $25+ offers while the list is small.</p>'
          : '<p class="low-price-warning" id="price-warning" hidden><strong>Volume warning:</strong> Lower prices require more buyers. Your current strategy favors $25+ offers while the list is small.</p>') +
        '<label for="priceRationale">Why is this worth the price?</label>' +
        '<p class="small-note">Consider the problem, desired outcome, specificity of the solution, and what the buyer receives. The goal is not to prove that someone somewhere would pay this amount. Decide whether the product, promise, and price make sense together.</p>' +
        '<textarea class="big" id="priceRationale" name="priceRationale" placeholder="This is worth $___ because...">' + escapeHtml(data.priceRationale) + "</textarea>" +
      "</div>" +

      '<div class="card question-card">' +
        "<h2>6. Does this offer deserve six pitches?</h2>" +
        '<p class="small-note">Read your five answers above. Don’t ask whether you personally love the idea. Ask whether this is a plausible paid offer worth putting in front of the list enough times to get real buying evidence.</p>' +
        '<div class="verdict-choices">' +
          verdictButton("yes", "YES: TEST IT", "The offer is clear enough to deserve a campaign.") +
          verdictButton("not_yet", "NOT YET: KEEP THINKING", "Something about the buyer, problem, product, differentiation, or price is still fuzzy.") +
          verdictButton("no", "NO: DROP IT", "This idea does not deserve six pitches.") +
        "</div>" +
      "</div>"
    );
  }

  function verdictButton(value, title, description) {
    var selected = data.verdict === value;
    return (
      '<button type="button" class="verdict-choice' + (selected ? " selected" : "") + '" data-action="set-verdict" data-verdict="' + value + '">' +
        '<span class="verdict-title">' + title + "</span>" +
        '<span class="verdict-desc">' + description + "</span>" +
      "</button>"
    );
  }

  function renderVerdictResult() {
    if (data.verdict === "yes") {
      return (
        '<div class="card result-good">' +
          "<h2>This Offer Survived Scrutiny</h2>" +
          "<p><strong>Outcome</strong></p><p>" + nl2br(data.outcome) + "</p>" +
          "<p><strong>Buyer</strong></p><p>" + nl2br(data.buyer) + "</p>" +
          "<p><strong>Product</strong></p><p>" + nl2br(data.product) + "</p>" +
          "<p><strong>Why This Product</strong></p><p>" + nl2br(data.differentiation) + "</p>" +
          "<p><strong>Price</strong></p><p>$" + escapeHtml(data.price) + " &mdash; " + nl2br(data.priceRationale) + "</p>" +
          '<div class="rule-banner">' +
            "<p><strong>Next step: Turn this into a campaign.</strong></p>" +
            "<p>The offer has earned the right to be tested.</p>" +
            "<p>Now stop evaluating the idea and let purchases evaluate it.</p>" +
          "</div>" +
          '<a class="primary-link" href="index.html">CREATE CAMPAIGN &rarr;</a>' +
        "</div>"
      );
    }

    if (data.verdict === "not_yet") {
      return (
        '<div class="card result-neutral">' +
          "<h2>Not Ready Yet</h2>" +
          "<p>Don’t commit six emails to a fuzzy offer.</p>" +
          "<p>Keep working on the questions above until the offer becomes clear enough to test or weak enough to discard.</p>" +
        "</div>"
      );
    }

    if (data.verdict === "no") {
      return (
        '<div class="card result-bad">' +
          "<h2>Drop It</h2>" +
          "<p>Good. You avoided spending six emails testing something you don’t believe deserves the attention.</p>" +
          "<p>Clear the page when you’re ready to pressure-test another idea.</p>" +
          '<button type="button" class="secondary danger" data-action="clear-all">CLEAR AND TEST ANOTHER IDEA</button>' +
        "</div>"
      );
    }

    return "";
  }

  function render() {
    app.innerHTML = renderQuestions() + renderVerdictResult();
  }

  // ---------- events ----------

  app.addEventListener("input", function (e) {
    var field = e.target;
    if (!field.name || !(field.name in data)) return;
    data[field.name] = field.value;
    saveData();
    if (field.id === "price") {
      var warning = document.getElementById("price-warning");
      if (warning) warning.hidden = num(data.price) >= 25;
    }
  });

  app.addEventListener("click", function (e) {
    var target = e.target.closest("[data-action]");
    if (!target) return;
    var action = target.dataset.action;

    if (action === "set-verdict") {
      data.verdict = target.dataset.verdict;
      saveData();
      render();
    } else if (action === "clear-all") {
      if (confirm("This clears all answers on this page. Continue?")) {
        data = emptyData();
        saveData();
        render();
      }
    }
  });

  // ---------- init ----------

  render();
})();

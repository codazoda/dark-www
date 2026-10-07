(function () {
  "use strict";

  var STORAGE_KEY = "email-strategy-data-v1";

  // ---------- storage ----------

  function loadData() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { campaigns: [] };
      var parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.campaigns)) return { campaigns: [] };
      return parsed;
    } catch (e) {
      return { campaigns: [] };
    }
  }

  function saveData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  var data = loadData();

  // transient UI state, never persisted
  var ui = {
    view: "main", // main | archive | archiveDetail
    archiveDetailId: null,
    editingPitchId: null, // pitch currently open in the record modal
    showChangeExperiment: false
  };

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }

  // ---------- helpers ----------

  function activeCampaign() {
    for (var i = 0; i < data.campaigns.length; i++) {
      if (data.campaigns[i].status === "active") return data.campaigns[i];
    }
    return null;
  }

  function archivedCampaigns() {
    return data.campaigns
      .filter(function (c) { return c.status === "archived"; })
      .sort(function (a, b) { return (b.completed_at || "").localeCompare(a.completed_at || ""); });
  }

  function num(v) {
    var n = Number(v);
    return isNaN(n) ? 0 : n;
  }

  function money(v) {
    return "$" + num(v).toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  function pct(v) {
    return num(v).toFixed(0) + "%";
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function nl2br(s) {
    return escapeHtml(s).replace(/\n/g, "<br>");
  }

  function localToday() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  // Sent only when the send date is a valid calendar date, today or earlier (local time).
  function isSent(pitch) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(pitch.actual_send_date || "");
    if (!m) return false;
    var y = +m[1], mo = +m[2], d = +m[3];
    var dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return false;
    return pitch.actual_send_date <= localToday();
  }

  function hasFuturePitch() {
    return data.campaigns.some(function (c) {
      return c.pitches.some(function (p) { return !!p.actual_send_date && !isSent(p); });
    });
  }

  var midnightTimer = null;
  function scheduleMidnightRender() {
    clearTimeout(midnightTimer);
    midnightTimer = null;
    if (!hasFuturePitch()) return;
    var now = new Date();
    var next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
    midnightTimer = setTimeout(function () {
      // don't wipe an open form; try again shortly
      if (ui.editingPitchId || ui.showChangeExperiment) {
        midnightTimer = setTimeout(scheduleMidnightRender, 60000);
        return;
      }
      render();
    }, next - now);
  }

  function sentPitches(campaign) {
    return campaign.pitches.filter(isSent);
  }

  function totalPurchases(campaign) {
    return sentPitches(campaign).reduce(function (sum, p) { return sum + num(p.purchases); }, 0);
  }

  function totalRevenue(campaign) {
    return sentPitches(campaign).reduce(function (sum, p) { return sum + num(p.revenue); }, 0);
  }

  function totalUnsubscribes(campaign) {
    return sentPitches(campaign).reduce(function (sum, p) { return sum + num(p.unsubscribes); }, 0);
  }

  function totalClicks(campaign) {
    return sentPitches(campaign).reduce(function (sum, p) { return sum + num(p.clicks); }, 0);
  }

  function avgOpenRate(campaign) {
    var sent = sentPitches(campaign).filter(function (p) { return num(p.delivered) > 0; });
    if (!sent.length) return 0;
    var rates = sent.map(function (p) { return num(p.opens) / num(p.delivered) * 100; });
    return rates.reduce(function (a, b) { return a + b; }, 0) / rates.length;
  }

  function revenuePerStartingSubscriber(campaign) {
    var listSize = num(campaign.starting_list_size);
    if (!listSize) return null;
    return totalRevenue(campaign) / listSize;
  }

  function nextPitch(campaign) {
    var sorted = campaign.pitches.slice().sort(function (a, b) { return a.pitch_number - b.pitch_number; });
    for (var i = 0; i < sorted.length; i++) {
      if (!isSent(sorted[i])) return sorted[i];
    }
    return null;
  }

  function pitchStatusLabel(campaign, pitch) {
    if (isSent(pitch)) return "Sent";
    var next = nextPitch(campaign);
    if (next && next.id === pitch.id) return "Next";
    return "Planned";
  }

  function isCampaignComplete(campaign) {
    return campaign.pitches.length > 0 && campaign.pitches.every(isSent);
  }

  function cadenceDaysOffset(cadence, pitchNumber) {
    if (cadence === "Weekly") return (pitchNumber - 1) * 7;
    if (cadence === "Twice weekly") return Math.round((pitchNumber - 1) * 3.5);
    return null;
  }

  function addDays(dateStr, days) {
    if (!dateStr || days == null) return "";
    var d = new Date(dateStr + "T00:00:00");
    if (isNaN(d.getTime())) return "";
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function formatDate(dateStr) {
    if (!dateStr) return "—";
    var d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr + "T00:00:00" : dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function buildPitches(planned_pitch_count, campaign_start, cadence) {
    var pitches = [];
    for (var i = 1; i <= planned_pitch_count; i++) {
      pitches.push({
        id: uid(),
        pitch_number: i,
        planned_date: addDays(campaign_start, cadenceDaysOffset(cadence, i)),
        actual_send_date: "",
        delivered: "",
        opens: "",
        clicks: "",
        unsubscribes: "",
        purchases: "",
        revenue: "",
        replies: "",
        notes: ""
      });
    }
    return pitches;
  }

  // ---------- rendering ----------

  var app = document.getElementById("app");

  function render() {
    if (ui.view === "archive") {
      app.innerHTML = renderArchiveList();
    } else if (ui.view === "archiveDetail") {
      app.innerHTML = renderArchiveDetail();
    } else {
      var campaign = activeCampaign();
      if (!campaign) {
        app.innerHTML = renderNewCampaignForm();
      } else if (isCampaignComplete(campaign) && !campaign.final_decision) {
        app.innerHTML = renderCompleteScreen(campaign);
      } else {
        app.innerHTML = renderCockpit(campaign);
      }
    }

    if (ui.editingPitchId) {
      var c = activeCampaign();
      var pitch = c && c.pitches.find(function (p) { return p.id === ui.editingPitchId; });
      if (pitch) app.insertAdjacentHTML("beforeend", renderPitchModal(c, pitch));
    }

    if (ui.showChangeExperiment) {
      var cc = activeCampaign();
      if (cc) app.insertAdjacentHTML("beforeend", renderChangeExperimentModal(cc));
    }

    document.getElementById("archive-nav-btn").textContent =
      "Archive" + (archivedCampaigns().length ? " (" + archivedCampaigns().length + ")" : "");

    scheduleMidnightRender();
  }

  function renderNewCampaignForm() {
    var hasArchive = archivedCampaigns().length > 0;
    return (
      '<div class="card alt story-reminder">' +
        "<h2>ONE OFFER AT A TIME</h2>" +
        "<p>Pick something worth testing.</p>" +
        '<p><a href="pressure-test.html">Pressure Test an Offer &rarr;</a></p>' +
        "<p>Define the experiment before seeing the results.</p>" +
        "<p>Then finish the experiment.</p>" +
      "</div>" +
      (hasArchive
        ? '<p class="small-note"><button type="button" class="link-btn" id="view-archive-inline" style="padding:0;min-height:auto;">See past experiments &rarr;</button></p>'
        : "") +
      '<form id="new-campaign-form" class="card">' +
        "<h2>New Campaign</h2>" +
        '<label for="offer_name">Offer Name <span class="hint">short internal name</span></label>' +
        '<input type="text" id="offer_name" name="offer_name" required placeholder="Local LLM Starter Course">' +

        '<label for="offer_description">What is it?</label>' +
        '<textarea id="offer_description" name="offer_description" required></textarea>' +

        '<label for="audience">Who is it for?</label>' +
        '<textarea id="audience" name="audience" required></textarea>' +

        '<label for="problem">Problem <span class="hint">what problem does the buyer already recognize?</span></label>' +
        '<textarea id="problem" name="problem"></textarea>' +

        '<label for="promise">Promise <span class="hint">what outcome does the buyer get?</span></label>' +
        '<textarea id="promise" name="promise"></textarea>' +

        '<div class="field-row">' +
          '<div><label for="price">Price</label><input type="number" id="price" name="price" min="0" step="1" value="25" required></div>' +
          '<div><label for="delivery_type">Delivery</label>' +
            '<select id="delivery_type" name="delivery_type">' +
              "<option>Already exists</option>" +
              "<option>Can deliver immediately</option>" +
              "<option>Pre-sell, then build</option>" +
              "<option>Other</option>" +
            "</select>" +
          "</div>" +
        "</div>" +
        '<p class="small-note" id="price-warning" hidden>Low price requires more volume.</p>' +

        '<label for="audience_fit">Why this fits the current list</label>' +
        '<textarea id="audience_fit" name="audience_fit"></textarea>' +

        '<div class="field-row">' +
          '<div><label for="planned_pitch_count">Number of pitches</label><input type="number" id="planned_pitch_count" name="planned_pitch_count" min="1" step="1" value="6" required></div>' +
          '<div><label for="campaign_start">Campaign start date</label><input type="date" id="campaign_start" name="campaign_start" required></div>' +
        "</div>" +

        '<label for="cadence">Planned cadence</label>' +
        '<select id="cadence" name="cadence">' +
          "<option>Weekly</option>" +
          "<option>Twice weekly</option>" +
          "<option>Custom</option>" +
        "</select>" +

        '<div class="field-row">' +
          '<div><label for="minimum_interesting_purchases">Minimum result that would interest me <span class="hint">purchases</span></label><input type="number" id="minimum_interesting_purchases" name="minimum_interesting_purchases" min="0" step="1"></div>' +
          '<div><label for="optional_revenue_target">Optional revenue target</label><input type="number" id="optional_revenue_target" name="optional_revenue_target" min="0" step="1"></div>' +
        "</div>" +

        '<label for="delivery_commitment">What happens if people buy?</label>' +
        '<textarea id="delivery_commitment" name="delivery_commitment"></textarea>' +

        '<label for="starting_list_size">Starting list size</label>' +
        '<input type="number" id="starting_list_size" name="starting_list_size" min="0" step="1" required>' +

        '<button type="submit" class="primary">START CAMPAIGN</button>' +
      "</form>"
    );
  }

  function renderCockpit(campaign) {
    var completed = sentPitches(campaign).length;
    var planned = campaign.planned_pitch_count;
    var next = nextPitch(campaign);
    var purchases = totalPurchases(campaign);
    var revenue = totalRevenue(campaign);
    var unsub = totalUnsubscribes(campaign);
    var rps = revenuePerStartingSubscriber(campaign);
    var lowPrice = num(campaign.price) < 25;

    var verdictLine;
    if (completed === 0) {
      verdictLine = "No pitches sent yet. Experiment not started.";
    } else if (purchases === 0) {
      var remaining = planned - completed;
      verdictLine = remaining > 0
        ? "0 purchases so far. " + remaining + " planned pitch" + (remaining === 1 ? "" : "es") + " remain."
        : "0 purchases so far. Experiment incomplete.";
    } else {
      verdictLine = purchases + " purchase" + (purchases === 1 ? "" : "s") + " so far. Experiment in progress.";
    }

    var rows = campaign.pitches
      .slice()
      .sort(function (a, b) { return a.pitch_number - b.pitch_number; })
      .map(function (p) {
        var label = pitchStatusLabel(campaign, p);
        var badgeClass = label === "Sent" ? "sent" : label === "Next" ? "next" : "";
        return (
          '<tr tabindex="0" data-action="edit-pitch" data-pitch-id="' + p.id + '">' +
            "<td>" + p.pitch_number + "</td>" +
            "<td><span class=\"status-badge " + badgeClass + "\">" + label + "</span></td>" +
            "<td>" + (isSent(p) ? formatDate(p.actual_send_date) : formatDate(p.planned_date)) + "</td>" +
            "<td>" + (isSent(p) ? num(p.purchases) : "") + "</td>" +
            "<td>" + (isSent(p) ? money(p.revenue) : "") + "</td>" +
          "</tr>"
        );
      })
      .join("");

    return (
      '<div class="card offer-block">' +
        "<h2>CURRENT OFFER</h2>" +
        '<div class="offer-name">' + escapeHtml(campaign.offer_name) + "</div>" +
        '<div class="offer-price">' + money(campaign.price) + "</div>" +
        (lowPrice ? '<div class="low-price-warning">Low price requires more volume.</div>' : "") +
        '<div class="offer-meta">' + escapeHtml(campaign.offer_description) + "</div>" +
        '<div class="offer-meta"><strong>For:</strong> ' + escapeHtml(campaign.audience) + "</div>" +
      "</div>" +

      '<div class="rule-banner">' +
        "<h2>DON'T CHANGE THE OFFER YET</h2>" +
        "<p>You committed to testing this offer <strong>" + planned + " times</strong>.</p>" +
        "<p>You are currently on <strong>Pitch " + Math.min(completed + 1, planned) + " of " + planned + "</strong>.</p>" +
        "<p>Finish the experiment before deciding what the results mean.</p>" +
      "</div>" +

      '<div class="results-row">' +
        '<div class="stat"><div class="label">Purchases</div><div class="value">' + purchases + "</div></div>" +
        '<div class="stat"><div class="label">Revenue</div><div class="value">' + money(revenue) + "</div></div>" +
      "</div>" +
      '<div class="progress-line">' + completed + " / " + planned + " pitches completed</div>" +
      '<p class="small-note">' + verdictLine + "</p>" +

      '<div class="card alt story-reminder">' +
        "<h3>Today's job: Stay with the offer.</h3>" +
        "<p>Write whatever story moves you. The story can be technical, personal, useful, entertaining, strange, or completely unrelated to the product. You don't need to manufacture a lesson that connects it to the offer.</p>" +
        "<p>When the story is finished, make the offer.</p>" +
        (next ? '<p><strong>Next send:</strong> ' + formatDate(next.planned_date) + " &mdash; Pitch " + next.pitch_number + "</p>" : "") +
      "</div>" +

      '<div class="card">' +
        "<h3>Campaign Progress</h3>" +
        '<table class="pitch-table"><thead><tr><th>Pitch</th><th>Status</th><th>Date</th><th>Purchases</th><th>Revenue</th></tr></thead>' +
        "<tbody>" + rows + "</tbody></table>" +
      "</div>" +

      '<div class="card">' +
        "<h3>Results So Far</h3>" +
        '<div class="results-row">' +
          '<div class="stat secondary"><div class="label">Avg. open rate</div><div class="value">' + pct(avgOpenRate(campaign)) + "</div></div>" +
          '<div class="stat secondary"><div class="label">Total clicks</div><div class="value">' + totalClicks(campaign) + "</div></div>" +
          '<div class="stat secondary"><div class="label">Unsubscribes</div><div class="value">' + unsub + "</div></div>" +
        "</div>" +
        '<div class="secondary-line">' +
          (campaign.starting_list_size !== "" ? num(campaign.starting_list_size) + " starting subscribers" : "") +
          (rps != null ? " · " + money(rps) + " revenue per starting subscriber" : "") +
        "</div>" +
        '<label for="current_list_size">Current list size</label>' +
        '<input type="number" id="current_list_size" name="current_list_size" min="0" step="1" data-action="update-list-size" value="' +
          escapeHtml(campaign.current_list_size !== undefined && campaign.current_list_size !== "" ? campaign.current_list_size : campaign.starting_list_size) + '">' +
      "</div>" +

      '<div class="card">' +
        "<h3>Experiment Details</h3>" +
        '<p class="secondary-line"><strong>Problem:</strong> ' + escapeHtml(campaign.problem || "—") + "</p>" +
        '<p class="secondary-line"><strong>Promise:</strong> ' + escapeHtml(campaign.promise || "—") + "</p>" +
        '<p class="secondary-line"><strong>Delivery:</strong> ' + escapeHtml(campaign.delivery_type) + "</p>" +
        '<p class="secondary-line"><strong>Why this fits the list:</strong> ' + escapeHtml(campaign.audience_fit || "—") + "</p>" +
        '<p class="secondary-line"><strong>Cadence:</strong> ' + escapeHtml(campaign.cadence) + "</p>" +
        '<p class="secondary-line"><strong>Minimum interesting result:</strong> ' + num(campaign.minimum_interesting_purchases) + " purchases" +
          (campaign.optional_revenue_target ? " / " + money(campaign.optional_revenue_target) : "") + "</p>" +
        '<p class="secondary-line"><strong>If people buy:</strong> ' + escapeHtml(campaign.delivery_commitment || "—") + "</p>" +
        (campaign.plan_changes && campaign.plan_changes.length
          ? '<p class="plan-changed-note">Plan changed ' + campaign.plan_changes.length + " time" + (campaign.plan_changes.length === 1 ? "" : "s") + " since launch.</p>"
          : "") +
        '<button type="button" class="secondary" data-action="open-change-experiment">Change Experiment</button>' +
      "</div>"
    );
  }

  function renderPitchModal(campaign, pitch) {
    return (
      '<div class="modal-overlay" data-action="close-modal-overlay">' +
        '<div class="modal">' +
          "<h2>Pitch " + pitch.pitch_number + " of " + campaign.planned_pitch_count + "</h2>" +
          '<form id="pitch-form">' +
            '<label for="actual_send_date">Send date</label>' +
            '<input type="date" id="actual_send_date" name="actual_send_date" value="' + escapeHtml(pitch.actual_send_date || pitch.planned_date || "") + '">' +

            '<div class="field-row">' +
              '<div><label for="purchases">Purchases</label><input type="number" id="purchases" name="purchases" min="0" step="1" value="' + escapeHtml(pitch.purchases) + '"></div>' +
              '<div><label for="revenue">Revenue</label><input type="number" id="revenue" name="revenue" min="0" step="0.01" value="' + escapeHtml(pitch.revenue) + '"></div>' +
            "</div>" +

            '<fieldset><legend>Secondary metrics</legend>' +
              '<div class="field-row">' +
                '<div><label for="delivered">Delivered</label><input type="number" id="delivered" name="delivered" min="0" step="1" value="' + escapeHtml(pitch.delivered) + '"></div>' +
                '<div><label for="opens">Opens</label><input type="number" id="opens" name="opens" min="0" step="1" value="' + escapeHtml(pitch.opens) + '"></div>' +
              "</div>" +
              '<div class="field-row">' +
                '<div><label for="clicks">Clicks</label><input type="number" id="clicks" name="clicks" min="0" step="1" value="' + escapeHtml(pitch.clicks) + '"></div>' +
                '<div><label for="unsubscribes">Unsubscribes</label><input type="number" id="unsubscribes" name="unsubscribes" min="0" step="1" value="' + escapeHtml(pitch.unsubscribes) + '"></div>' +
              "</div>" +
            "</fieldset>" +

            '<label for="replies">Replies <span class="hint">optional</span></label>' +
            '<input type="number" id="replies" name="replies" min="0" step="1" value="' + escapeHtml(pitch.replies) + '">' +

            '<label for="notes">Notes <span class="hint">optional</span></label>' +
            '<textarea id="notes" name="notes">' + escapeHtml(pitch.notes) + "</textarea>" +

            '<div class="modal-buttons">' +
              '<button type="button" class="secondary" data-action="cancel-pitch">Cancel</button>' +
              '<button type="submit" class="primary" style="margin-top:0;">Save</button>' +
            "</div>" +
          "</form>" +
        "</div>" +
      "</div>"
    );
  }

  function renderChangeExperimentModal(campaign) {
    return (
      '<div class="modal-overlay" data-action="close-modal-overlay">' +
        '<div class="modal">' +
          "<h2>Change Experiment</h2>" +
          "<p class=\"small-note\">Changing the plan mid-campaign is recorded. Do this only for a real reason, not to dodge a disappointing result.</p>" +
          '<form id="change-experiment-form">' +
            '<label for="new_pitch_count">Number of pitches</label>' +
            '<input type="number" id="new_pitch_count" name="new_pitch_count" min="' + sentPitches(campaign).length + '" step="1" value="' + campaign.planned_pitch_count + '">' +
            '<p class="small-note">Cannot be fewer than the ' + sentPitches(campaign).length + " pitch(es) already sent.</p>" +
            '<div class="modal-buttons">' +
              '<button type="button" class="secondary" data-action="cancel-change-experiment">Cancel</button>' +
              '<button type="submit" class="primary" style="margin-top:0;">Confirm Change</button>' +
            "</div>" +
          "</form>" +
        "</div>" +
      "</div>"
    );
  }

  function renderCompleteScreen(campaign) {
    var rows = campaign.pitches
      .slice()
      .sort(function (a, b) { return a.pitch_number - b.pitch_number; })
      .map(function (p) {
        return (
          "<tr><td>" + p.pitch_number + "</td><td>" + (isSent(p) ? formatDate(p.actual_send_date) : "") + "</td><td>" +
          (isSent(p) ? num(p.purchases) : "") + "</td><td>" + (isSent(p) ? money(p.revenue) : "") + "</td></tr>"
        );
      })
      .join("");

    var endingListSize = campaign.current_list_size !== undefined && campaign.current_list_size !== ""
      ? campaign.current_list_size
      : campaign.starting_list_size;
    var rps = revenuePerStartingSubscriber(campaign);

    return (
      '<div class="card alt">' +
        "<h2>EXPERIMENT COMPLETE</h2>" +
        '<p class="secondary-line"><strong>Offer:</strong> ' + escapeHtml(campaign.offer_name) + "</p>" +
        '<p class="secondary-line"><strong>Price:</strong> ' + money(campaign.price) + "</p>" +
        '<p class="secondary-line"><strong>Starting list size:</strong> ' + num(campaign.starting_list_size) + "</p>" +
        '<p class="secondary-line"><strong>Number of pitches:</strong> ' + campaign.planned_pitch_count + "</p>" +
      "</div>" +

      '<div class="results-row">' +
        '<div class="stat"><div class="label">Total purchases</div><div class="value">' + totalPurchases(campaign) + "</div></div>" +
        '<div class="stat"><div class="label">Total revenue</div><div class="value">' + money(totalRevenue(campaign)) + "</div></div>" +
      "</div>" +
      '<div class="results-row">' +
        '<div class="stat secondary"><div class="label">Revenue / subscriber</div><div class="value">' + (rps != null ? money(rps) : "—") + "</div></div>" +
        '<div class="stat secondary"><div class="label">Total unsubscribes</div><div class="value">' + totalUnsubscribes(campaign) + "</div></div>" +
        '<div class="stat secondary"><div class="label">Ending list size</div><div class="value">' + num(endingListSize) + "</div></div>" +
      "</div>" +

      '<div class="card">' +
        "<h3>Purchase results by pitch</h3>" +
        '<table class="pitch-table"><thead><tr><th>Pitch</th><th>Date</th><th>Purchases</th><th>Revenue</th></tr></thead>' +
        "<tbody>" + rows + "</tbody></table>" +
      "</div>" +

      '<form id="decision-form" class="card">' +
        "<h3>What did the market tell me?</h3>" +
        '<fieldset><legend>Decision</legend>' +
          '<label><input type="radio" name="final_decision" value="KEEP SELLING" required> <strong>KEEP SELLING</strong> &mdash; enough buying evidence to continue selling the offer.</label>' +
          '<label><input type="radio" name="final_decision" value="ITERATE AND RETEST"> <strong>ITERATE AND RETEST</strong> &mdash; some evidence, but a meaningful change is worth testing.</label>' +
          '<label><input type="radio" name="final_decision" value="STOP"> <strong>STOP</strong> &mdash; not enough buying evidence to continue this offer.</label>' +
        "</fieldset>" +

        '<label for="factual_summary">What happened? <span class="hint">brief factual summary</span></label>' +
        '<textarea id="factual_summary" name="factual_summary" required placeholder="6 pitches, 4 buyers, $100 revenue."></textarea>' +

        '<label for="lessons">What did I learn?</label>' +
        '<textarea id="lessons" name="lessons" required></textarea>' +

        '<label for="next_action">What will I do next?</label>' +
        '<textarea id="next_action" name="next_action" required></textarea>' +

        '<button type="submit" class="primary">Archive Experiment</button>' +
      "</form>"
    );
  }

  function renderArchiveList() {
    var campaigns = archivedCampaigns();
    var body = campaigns.length
      ? '<div class="archive-list">' + campaigns.map(function (c) {
          return (
            '<div class="archive-item" tabindex="0" data-action="open-archive-detail" data-campaign-id="' + c.id + '">' +
              '<div class="name">' + escapeHtml(c.offer_name) + " &mdash; " + money(c.price) + "</div>" +
              '<div class="meta">' + formatDate(c.campaign_start) + " → " + formatDate(c.completed_at) +
                " · " + sentPitches(c).length + "/" + c.planned_pitch_count + " pitches · " +
                totalPurchases(c) + " purchases · " + money(totalRevenue(c)) + "</div>" +
              '<span class="decision">' + escapeHtml(c.final_decision) + "</span>" +
            "</div>"
          );
        }).join("") + "</div>"
      : '<div class="empty-state"><p>No archived experiments yet.</p></div>';

    return (
      '<button type="button" class="secondary" data-action="back-to-main">&larr; Back</button>' +
      "<h2>Archive</h2>" +
      body
    );
  }

  function renderArchiveDetail() {
    var campaign = data.campaigns.find(function (c) { return c.id === ui.archiveDetailId; });
    if (!campaign) return '<button type="button" class="secondary" data-action="view-archive">&larr; Back to archive</button>';

    var rows = campaign.pitches
      .slice()
      .sort(function (a, b) { return a.pitch_number - b.pitch_number; })
      .map(function (p) {
        return (
          "<tr><td>" + p.pitch_number + "</td><td>" + (isSent(p) ? formatDate(p.actual_send_date) : "") + "</td><td>" +
          (isSent(p) ? num(p.purchases) : "") + "</td><td>" + (isSent(p) ? money(p.revenue) : "") + "</td><td>" + (isSent(p) ? num(p.opens) : "") + "</td><td>" + (isSent(p) ? num(p.unsubscribes) : "") + "</td></tr>"
        );
      })
      .join("");

    var rps = revenuePerStartingSubscriber(campaign);
    var endingListSize = campaign.current_list_size !== undefined && campaign.current_list_size !== ""
      ? campaign.current_list_size
      : campaign.starting_list_size;

    return (
      '<button type="button" class="secondary" data-action="view-archive">&larr; Back to archive</button>' +
      '<div class="card offer-block">' +
        '<div class="offer-name">' + escapeHtml(campaign.offer_name) + "</div>" +
        '<div class="offer-price">' + money(campaign.price) + "</div>" +
        '<div class="offer-meta">' + escapeHtml(campaign.offer_description) + "</div>" +
        '<div class="offer-meta"><strong>For:</strong> ' + escapeHtml(campaign.audience) + "</div>" +
        '<span class="decision status-badge">' + escapeHtml(campaign.final_decision) + "</span>" +
      "</div>" +

      '<div class="results-row">' +
        '<div class="stat"><div class="label">Total purchases</div><div class="value">' + totalPurchases(campaign) + "</div></div>" +
        '<div class="stat"><div class="label">Total revenue</div><div class="value">' + money(totalRevenue(campaign)) + "</div></div>" +
      "</div>" +
      '<div class="secondary-line">' +
        num(campaign.starting_list_size) + " → " + num(endingListSize) + " subscribers" +
        (rps != null ? " · " + money(rps) + " revenue/subscriber" : "") +
        " · " + totalUnsubscribes(campaign) + " unsubscribes" +
      "</div>" +

      '<div class="card">' +
        "<h3>Sends</h3>" +
        '<table class="pitch-table"><thead><tr><th>#</th><th>Date</th><th>Purch.</th><th>Rev.</th><th>Opens</th><th>Unsub.</th></tr></thead>' +
        "<tbody>" + rows + "</tbody></table>" +
      "</div>" +

      '<div class="card">' +
        "<h3>Notes</h3>" +
        '<p class="secondary-line"><strong>What happened?</strong><br>' + nl2br(campaign.factual_summary) + "</p>" +
        '<p class="secondary-line"><strong>What did I learn?</strong><br>' + nl2br(campaign.lessons) + "</p>" +
        '<p class="secondary-line"><strong>What will I do next?</strong><br>' + nl2br(campaign.next_action) + "</p>" +
      "</div>"
    );
  }

  // ---------- event handling ----------

  app.addEventListener("submit", function (e) {
    if (e.target.id === "new-campaign-form") {
      e.preventDefault();
      handleNewCampaignSubmit(e.target);
    } else if (e.target.id === "pitch-form") {
      e.preventDefault();
      handlePitchSubmit(e.target);
    } else if (e.target.id === "decision-form") {
      e.preventDefault();
      handleDecisionSubmit(e.target);
    } else if (e.target.id === "change-experiment-form") {
      e.preventDefault();
      handleChangeExperimentSubmit(e.target);
    }
  });

  app.addEventListener("input", function (e) {
    if (e.target.id === "price") {
      var warn = document.getElementById("price-warning");
      if (warn) warn.hidden = num(e.target.value) >= 25;
    }
  });

  app.addEventListener("change", function (e) {
    if (e.target.dataset && e.target.dataset.action === "update-list-size") {
      var campaign = activeCampaign();
      if (campaign) {
        campaign.current_list_size = e.target.value;
        saveData();
      }
    }
  });

  app.addEventListener("click", function (e) {
    var target = e.target.closest("[data-action]");
    if (!target) return;
    var action = target.dataset.action;

    if (action === "edit-pitch") {
      ui.editingPitchId = target.dataset.pitchId;
      render();
    } else if (action === "cancel-pitch" || (action === "close-modal-overlay" && e.target === target && ui.editingPitchId)) {
      ui.editingPitchId = null;
      render();
    } else if (action === "open-change-experiment") {
      ui.showChangeExperiment = true;
      render();
    } else if (action === "cancel-change-experiment") {
      ui.showChangeExperiment = false;
      render();
    } else if (action === "close-modal-overlay" && e.target === target && ui.showChangeExperiment) {
      ui.showChangeExperiment = false;
      render();
    } else if (action === "open-archive-detail") {
      ui.archiveDetailId = target.dataset.campaignId;
      ui.view = "archiveDetail";
      render();
    } else if (action === "view-archive") {
      ui.view = "archive";
      render();
    } else if (action === "back-to-main") {
      ui.view = "main";
      render();
    }
  });

  document.getElementById("archive-nav-btn").addEventListener("click", function () {
    ui.view = ui.view === "main" ? "archive" : "main";
    render();
  });

  app.addEventListener("click", function (e) {
    if (e.target.id === "view-archive-inline") {
      ui.view = "archive";
      render();
    }
  });

  function handleNewCampaignSubmit(form) {
    var fd = new FormData(form);
    var planned = Math.max(1, parseInt(fd.get("planned_pitch_count"), 10) || 6);
    var start = fd.get("campaign_start");
    var cadence = fd.get("cadence");

    var campaign = {
      id: uid(),
      offer_name: fd.get("offer_name"),
      offer_description: fd.get("offer_description"),
      audience: fd.get("audience"),
      problem: fd.get("problem"),
      promise: fd.get("promise"),
      price: fd.get("price"),
      delivery_type: fd.get("delivery_type"),
      audience_fit: fd.get("audience_fit"),
      planned_pitch_count: planned,
      campaign_start: start,
      cadence: cadence,
      minimum_interesting_purchases: fd.get("minimum_interesting_purchases"),
      optional_revenue_target: fd.get("optional_revenue_target"),
      delivery_commitment: fd.get("delivery_commitment"),
      starting_list_size: fd.get("starting_list_size"),
      current_list_size: fd.get("starting_list_size"),
      status: "active",
      final_decision: "",
      factual_summary: "",
      lessons: "",
      next_action: "",
      plan_changes: [],
      created_at: new Date().toISOString(),
      completed_at: "",
      pitches: buildPitches(planned, start, cadence)
    };

    data.campaigns.push(campaign);
    saveData();
    render();
  }

  function handlePitchSubmit(form) {
    var campaign = activeCampaign();
    if (!campaign) return;
    var pitch = campaign.pitches.find(function (p) { return p.id === ui.editingPitchId; });
    if (!pitch) return;

    var fd = new FormData(form);
    pitch.actual_send_date = fd.get("actual_send_date");
    pitch.purchases = fd.get("purchases");
    pitch.revenue = fd.get("revenue");
    pitch.delivered = fd.get("delivered");
    pitch.opens = fd.get("opens");
    pitch.clicks = fd.get("clicks");
    pitch.unsubscribes = fd.get("unsubscribes");
    pitch.replies = fd.get("replies");
    pitch.notes = fd.get("notes");

    ui.editingPitchId = null;
    saveData();
    render();
  }

  function handleDecisionSubmit(form) {
    var campaign = activeCampaign();
    if (!campaign) return;
    var fd = new FormData(form);

    campaign.final_decision = fd.get("final_decision");
    campaign.factual_summary = fd.get("factual_summary");
    campaign.lessons = fd.get("lessons");
    campaign.next_action = fd.get("next_action");
    campaign.status = "archived";
    campaign.completed_at = new Date().toISOString();

    saveData();
    render();
  }

  function handleChangeExperimentSubmit(form) {
    var campaign = activeCampaign();
    if (!campaign) return;
    var fd = new FormData(form);
    var newCount = Math.max(sentPitches(campaign).length, parseInt(fd.get("new_pitch_count"), 10) || campaign.planned_pitch_count);
    var oldCount = campaign.planned_pitch_count;

    if (newCount !== oldCount) {
      if (newCount > oldCount) {
        for (var i = oldCount + 1; i <= newCount; i++) {
          campaign.pitches.push({
            id: uid(),
            pitch_number: i,
            planned_date: addDays(campaign.campaign_start, cadenceDaysOffset(campaign.cadence, i)),
            actual_send_date: "",
            delivered: "",
            opens: "",
            clicks: "",
            unsubscribes: "",
            purchases: "",
            revenue: "",
            replies: "",
            notes: ""
          });
        }
      } else {
        campaign.pitches = campaign.pitches
          .slice()
          .sort(function (a, b) { return a.pitch_number - b.pitch_number; })
          .filter(function (p) { return p.pitch_number <= newCount || isSent(p); });
      }
      campaign.planned_pitch_count = newCount;
      campaign.plan_changes = campaign.plan_changes || [];
      campaign.plan_changes.push({ at: new Date().toISOString(), from: oldCount, to: newCount });
    }

    ui.showChangeExperiment = false;
    saveData();
    render();
  }

  // ---------- export / import ----------

  document.getElementById("export-btn").addEventListener("click", function () {
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    var today = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = "email-strategy-" + today + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  document.getElementById("import-input").addEventListener("change", function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = JSON.parse(reader.result);
        if (!parsed || !Array.isArray(parsed.campaigns)) throw new Error("Invalid file");
        if (!confirm("Import will replace all current campaign data on this device. Continue?")) {
          e.target.value = "";
          return;
        }
        data = parsed;
        saveData();
        ui.view = "main";
        ui.editingPitchId = null;
        ui.showChangeExperiment = false;
        render();
      } catch (err) {
        alert("Could not read that file as valid campaign data.");
      }
      e.target.value = "";
    };
    reader.readAsText(file);
  });

  // ---------- init ----------

  render();
})();

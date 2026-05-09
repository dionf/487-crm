(function () {
  "use strict";

  var script = document.currentScript;
  var tenant = script.getAttribute("data-tenant") || "hiphot";
  var lang = script.getAttribute("data-lang") || "nl";
  var targetId = script.getAttribute("data-target");
  var apiBase = script.src.replace(/\/(?:form-embed\.js|api\/public\/embed).*$/, "");

  // ---- Google Ads / GA tracking ---------------------------------------------
  // Wordt aangeroepen na een succesvolle form-submit (server-OK response).
  // Zelfde patroon als de offerte-chatbot: GTM dataLayer + GA4 generate_lead +
  // Google Ads conversion met enhanced user_data. HipHot deelt het Google Ads
  // conversion-label met de chatbot zodat alle lead-aanvragen samen geteld worden.
  // 48-7 leeg = graceful no-op tot er een conversion-actie is aangemaakt.
  var GADS_CONVERSION = {
    hiphot: "AW-410249570/CcR2CMq-rKocEOLSz8MB",
    "48-7": "",
  };
  var GA_EVENT_NAME = {
    hiphot: "hiphot_contact_aanvraag",
    "48-7": "487_contact_aanvraag",
  };
  var CONVERSION_VALUE = 75; // EUR — proxy-waarde, zelfde als chatbot

  // Format Dutch phone naar E.164 (+31...) voor Enhanced Conversions
  function formatPhoneE164(raw) {
    if (!raw) return null;
    var digits = String(raw).replace(/[^\d+]/g, "");
    if (digits.indexOf("+") === 0) return digits;
    if (digits.indexOf("00") === 0) return "+" + digits.slice(2);
    if (digits.indexOf("0") === 0) return "+31" + digits.slice(1);
    if (digits.length >= 9) return "+31" + digits;
    return null;
  }

  function fireConversionEvent(formData) {
    var sendTo = GADS_CONVERSION[tenant] || "";
    var eventName = GA_EVENT_NAME[tenant] || "contact_aanvraag";

    var userData = {
      email: formData.email || undefined,
      phone_number: formatPhoneE164(formData.phone) || undefined,
      address: {
        first_name: formData.first_name || undefined,
        last_name: formData.last_name || undefined,
      },
    };

    try {
      if (typeof window.dataLayer !== "undefined") {
        window.dataLayer.push({
          event: eventName,
          tenant: tenant,
          form_type: "contact",
          value: CONVERSION_VALUE,
          currency: "EUR",
        });
      }
    } catch (e) {}

    if (typeof window.gtag === "function") {
      try {
        window.gtag("event", "generate_lead", {
          event_category: "contact",
          event_label: tenant,
          value: CONVERSION_VALUE,
          currency: "EUR",
        });
      } catch (e) {}

      if (sendTo) {
        try {
          window.gtag("event", "conversion", {
            send_to: sendTo,
            value: CONVERSION_VALUE,
            currency: "EUR",
            user_data: userData,
          });
        } catch (e) {}
      }
    }
  }
  // ---------------------------------------------------------------------------

  var i18n = {
    nl: {
      firstName: "Voornaam",
      lastName: "Achternaam",
      phone: "Telefoonnummer",
      email: "E-mail",
      message: "Waar kunnen we je mee helpen?",
      submit: "Verzenden",
      sending: "Verzenden...",
      success: "Bedankt! We nemen snel contact op.",
      error: "Er ging iets mis. Probeer het opnieuw.",
      required: "Dit veld is verplicht",
      invalidEmail: "Ongeldig e-mailadres",
    },
    en: {
      firstName: "First name",
      lastName: "Surname",
      phone: "Phone number",
      email: "Email",
      message: "How can we help you?",
      submit: "Submit",
      sending: "Submitting...",
      success: "Thank you! We'll be in touch soon.",
      error: "Something went wrong. Please try again.",
      required: "This field is required",
      invalidEmail: "Invalid email address",
    },
    de: {
      firstName: "Vorname",
      lastName: "Nachname",
      phone: "Telefonnummer",
      email: "E-Mail",
      message: "Wie können wir Ihnen helfen?",
      submit: "Absenden",
      sending: "Wird gesendet...",
      success: "Vielen Dank! Wir melden uns bald.",
      error: "Etwas ist schiefgelaufen. Bitte erneut versuchen.",
      required: "Dieses Feld ist erforderlich",
      invalidEmail: "Ungültige E-Mail-Adresse",
    },
  };

  var t = i18n[lang] || i18n.nl;

  // Tenant theming
  var themes = {
    hiphot: { accent: "#FFD500", accentHover: "#e6c000", text: "#0d0d0d" },
    "48-7": { accent: "#FAB868", accentHover: "#e5a050", text: "#0d0d0d" },
  };
  var theme = themes[tenant] || themes.hiphot;

  // Inject styles
  var style = document.createElement("style");
  style.textContent =
    ".crm-form{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:640px;margin:0 auto}" +
    ".crm-form *{box-sizing:border-box}" +
    ".crm-form-row{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}" +
    ".crm-form-full{margin-bottom:16px}" +
    ".crm-form label{display:block;font-size:14px;font-weight:500;color:#374151;margin-bottom:6px}" +
    ".crm-form label .crm-req{color:#dc2626;margin-left:2px}" +
    ".crm-form input,.crm-form textarea{width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;font-size:15px;font-family:inherit;color:#1a1a1a;transition:border-color .2s}" +
    ".crm-form input:focus,.crm-form textarea:focus{outline:none;border-color:" + theme.accent + ";box-shadow:0 0 0 3px " + theme.accent + "33}" +
    ".crm-form textarea{min-height:120px;resize:vertical}" +
    ".crm-form input.crm-error,.crm-form textarea.crm-error{border-color:#dc2626}" +
    ".crm-form .crm-error-msg{font-size:12px;color:#dc2626;margin-top:4px}" +
    ".crm-form-btn{display:inline-flex;align-items:center;justify-content:center;padding:12px 32px;background:#0d0d0d;color:#ffffff;font-size:15px;font-weight:600;border:none;border-radius:999px;cursor:pointer;transition:background .2s}" +
    ".crm-form-btn:hover{background:#333333}" +
    ".crm-form-btn:disabled{opacity:.5;cursor:not-allowed}" +
    ".crm-form-success{background:#f0fdf4;border:2px solid #bbf7d0;border-radius:12px;padding:24px;text-align:center;font-size:16px;color:#166534;font-weight:500}" +
    ".crm-form-error-banner{background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px 16px;font-size:14px;color:#dc2626;margin-bottom:16px}" +
    ".crm-hp{position:absolute;left:-9999px;opacity:0;height:0;width:0;overflow:hidden}";
  document.head.appendChild(style);

  // Build form
  var container = targetId ? document.getElementById(targetId) : script.parentNode;
  if (!container) return;

  var wrapper = document.createElement("div");
  wrapper.className = "crm-form";
  wrapper.innerHTML =
    '<form id="crm-cf" novalidate>' +
    '<div id="crm-cf-error" class="crm-form-error-banner" style="display:none"></div>' +
    '<div class="crm-form-row">' +
    '  <div>' +
    '    <label>' + t.firstName + '<span class="crm-req">*</span></label>' +
    '    <input type="text" name="first_name" required autocomplete="given-name">' +
    '  </div>' +
    '  <div>' +
    '    <label>' + t.lastName + '<span class="crm-req">*</span></label>' +
    '    <input type="text" name="last_name" required autocomplete="family-name">' +
    '  </div>' +
    '</div>' +
    '<div class="crm-form-row">' +
    '  <div>' +
    '    <label>' + t.phone + '<span class="crm-req">*</span></label>' +
    '    <input type="tel" name="phone" required autocomplete="tel">' +
    '  </div>' +
    '  <div>' +
    '    <label>' + t.email + '<span class="crm-req">*</span></label>' +
    '    <input type="email" name="email" required autocomplete="email">' +
    '  </div>' +
    '</div>' +
    '<div class="crm-form-full">' +
    '  <label>' + t.message + '<span class="crm-req">*</span></label>' +
    '  <textarea name="message" required></textarea>' +
    '</div>' +
    // Honeypot
    '<div class="crm-hp"><input type="text" name="_hp" tabindex="-1" autocomplete="off"></div>' +
    '<button type="submit" class="crm-form-btn">' + t.submit + '</button>' +
    '</form>' +
    '<div id="crm-cf-success" class="crm-form-success" style="display:none">' + t.success + '</div>';

  container.appendChild(wrapper);

  var form = document.getElementById("crm-cf");
  var successEl = document.getElementById("crm-cf-success");
  var errorBanner = document.getElementById("crm-cf-error");
  var submitBtn = form.querySelector('button[type="submit"]');

  function validateField(input) {
    var parent = input.parentNode;
    var existing = parent.querySelector(".crm-error-msg");
    if (existing) existing.remove();
    input.classList.remove("crm-error");

    if (input.required && !input.value.trim()) {
      input.classList.add("crm-error");
      var msg = document.createElement("div");
      msg.className = "crm-error-msg";
      msg.textContent = t.required;
      parent.appendChild(msg);
      return false;
    }

    if (input.type === "email" && input.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value.trim())) {
      input.classList.add("crm-error");
      var msg2 = document.createElement("div");
      msg2.className = "crm-error-msg";
      msg2.textContent = t.invalidEmail;
      parent.appendChild(msg2);
      return false;
    }

    return true;
  }

  // Live validation on blur
  var inputs = form.querySelectorAll("input, textarea");
  for (var i = 0; i < inputs.length; i++) {
    inputs[i].addEventListener("blur", function () { validateField(this); });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    errorBanner.style.display = "none";

    // Validate all
    var valid = true;
    var formInputs = form.querySelectorAll("input[required], textarea[required]");
    for (var j = 0; j < formInputs.length; j++) {
      if (!validateField(formInputs[j])) valid = false;
    }
    if (!valid) return;

    // Disable
    submitBtn.disabled = true;
    submitBtn.textContent = t.sending;

    var data = {
      tenant: tenant,
      first_name: form.first_name.value.trim(),
      last_name: form.last_name.value.trim(),
      email: form.email.value.trim(),
      phone: form.phone.value.trim() || null,
      message: form.message.value.trim(),
      language: lang,
      source_url: window.location.href,
      _hp: form._hp.value,
    };

    fetch(apiBase + "/api/public/form-submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    })
      .then(function (res) {
        if (!res.ok) throw new Error("Server error");
        return res.json();
      })
      .then(function () {
        form.style.display = "none";
        successEl.style.display = "block";
        // Pas afvuren na bevestiging — geen conversion-event als de server faalt.
        fireConversionEvent(data);
      })
      .catch(function () {
        errorBanner.textContent = t.error;
        errorBanner.style.display = "block";
        submitBtn.disabled = false;
        submitBtn.textContent = t.submit;
      });
  });
})();

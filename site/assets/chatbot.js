// Плаваючий чат-віджет — пояснює проєкт і токен через /api/chat (Claude,
// курировано в api/chatbot_knowledge.js). Не показує особистих даних,
// не потребує підключення гаманця.
(function () {
  function curLang() {
    return document.documentElement.getAttribute("data-lang") || "uk";
  }
  function tr(uk, en, de) {
    const l = curLang();
    if (l === "uk") return uk;
    if (l === "de") return de || en;
    return en;
  }

  const style = document.createElement("style");
  style.textContent = `
    #rasaChatBtn{position:fixed; bottom:22px; right:22px; width:56px; height:56px; border-radius:50%; background:var(--gold); color:#1A1204; border:none; box-shadow:var(--shadow); cursor:pointer; font-size:24px; z-index:9998; display:flex; align-items:center; justify-content:center;}
    #rasaChatPanel{position:fixed; bottom:90px; right:22px; width:340px; max-width:calc(100vw - 32px); height:460px; max-height:calc(100vh - 120px); background:var(--bg-card); border:1px solid var(--line-soft); border-radius:10px; box-shadow:var(--shadow); z-index:9998; display:none; flex-direction:column; overflow:hidden; font-family:var(--sans);}
    #rasaChatPanel.open{display:flex;}
    #rasaChatHead{background:var(--bg-hero); color:var(--on-hero); padding:12px 14px; display:flex; justify-content:space-between; align-items:center; font-size:14.5px; font-weight:700;}
    #rasaChatHead button{background:none; border:none; color:var(--on-hero); font-size:18px; cursor:pointer; line-height:1;}
    #rasaChatMsgs{flex:1; overflow-y:auto; padding:12px; display:flex; flex-direction:column; gap:8px;}
    .rasa-msg{max-width:85%; padding:8px 11px; border-radius:8px; font-size:14px; line-height:1.45; white-space:pre-wrap;}
    .rasa-msg.user{align-self:flex-end; background:var(--gold-soft); color:var(--ink);}
    .rasa-msg.bot{align-self:flex-start; background:var(--bg-raised); color:var(--ink);}
    .rasa-msg.err{align-self:flex-start; background:var(--vermillion-soft); color:var(--vermillion);}
    #rasaChatForm{display:flex; gap:6px; padding:10px; border-top:1px solid var(--line-soft);}
    #rasaChatInput{flex:1; padding:9px 10px; border:1px solid var(--line); border-radius:6px; background:var(--bg); color:var(--ink); font-size:14px; font-family:inherit;}
    #rasaChatSend{padding:9px 14px; border:none; border-radius:6px; background:var(--gold); color:#1A1204; font-weight:700; cursor:pointer; font-size:14px;}
    #rasaChatSend:disabled{opacity:.5; cursor:default;}
  `;
  document.head.appendChild(style);

  const btn = document.createElement("button");
  btn.id = "rasaChatBtn";
  btn.setAttribute("aria-label", "Chat");
  btn.textContent = "💬";

  const panel = document.createElement("div");
  panel.id = "rasaChatPanel";
  panel.innerHTML = `
    <div id="rasaChatHead"><span id="rasaChatTitle"></span><button id="rasaChatClose" type="button">✕</button></div>
    <div id="rasaChatMsgs"></div>
    <form id="rasaChatForm">
      <input id="rasaChatInput" type="text" autocomplete="off">
      <button id="rasaChatSend" type="submit">➤</button>
    </form>
  `;

  document.body.appendChild(btn);
  document.body.appendChild(panel);

  const msgsEl = panel.querySelector("#rasaChatMsgs");
  const input = panel.querySelector("#rasaChatInput");
  const form = panel.querySelector("#rasaChatForm");
  const sendBtn = panel.querySelector("#rasaChatSend");
  const titleEl = panel.querySelector("#rasaChatTitle");

  let history = [];

  function applyLang() {
    titleEl.textContent = tr("Запитайте про проєкт", "Ask about the project", "Fragen Sie zum Projekt");
    input.placeholder = tr("Напишіть повідомлення...", "Type a message...", "Nachricht eingeben...");
    // Поки реального діалогу немає (history порожня), можна безпечно
    // перемалювати вітання іншою мовою — після першого реального
    // повідомлення історію більше не чіпаємо.
    if (history.length === 0) {
      msgsEl.innerHTML = "";
      addMsg("bot", tr(
        "Привіт! Я можу пояснити, як влаштований проєкт і токен Rasayana — питайте.",
        "Hi! I can explain how the Rasayana project and token work — ask away.",
        "Hallo! Ich kann erklären, wie das Rasayana-Projekt und der Token funktionieren — fragen Sie einfach."
      ));
    }
  }

  function addMsg(role, text) {
    const div = document.createElement("div");
    div.className = "rasa-msg " + role;
    div.textContent = text;
    msgsEl.appendChild(div);
    msgsEl.scrollTop = msgsEl.scrollHeight;
    return div;
  }

  let everOpened = false;
  btn.addEventListener("click", () => {
    panel.classList.toggle("open");
    if (panel.classList.contains("open") && !everOpened) {
      everOpened = true;
      applyLang();
    }
  });
  panel.querySelector("#rasaChatClose").addEventListener("click", () => panel.classList.remove("open"));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    addMsg("user", text);
    history.push({ role: "user", content: text });
    input.value = "";
    sendBtn.disabled = true;
    const pending = addMsg("bot", tr("Друкує...", "Typing...", "Tippt..."));

    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });
      const data = await resp.json();
      if (resp.status === 503) {
        pending.className = "rasa-msg err";
        pending.textContent = tr(
          "Чат ще не підключено. Напишіть напряму: pylypchukandrii770@gmail.com або через форму на сторінці «Що потрібно проєкту».",
          "Chat isn't connected yet. Please write directly: pylypchukandrii770@gmail.com or via the form on the \"What We Need\" page.",
          "Der Chat ist noch nicht verbunden. Bitte schreiben Sie direkt: pylypchukandrii770@gmail.com oder über das Formular auf der Seite „Was wir brauchen“."
        );
      } else if (resp.status === 429) {
        pending.className = "rasa-msg err";
        pending.textContent = tr("Забагато запитів, спробуйте за кілька хвилин.", "Too many requests, please try again in a few minutes.", "Zu viele Anfragen, bitte versuchen Sie es in ein paar Minuten erneut.");
      } else if (!resp.ok || !data.reply) {
        throw new Error("bad response");
      } else {
        pending.className = "rasa-msg bot";
        pending.textContent = data.reply;
        history.push({ role: "assistant", content: data.reply });
      }
    } catch (err) {
      pending.className = "rasa-msg err";
      pending.textContent = tr("Помилка з'єднання. Спробуйте ще раз.", "Connection error. Please try again.", "Verbindungsfehler. Bitte erneut versuchen.");
    } finally {
      sendBtn.disabled = false;
    }
  });

  new MutationObserver(applyLang).observe(document.documentElement, { attributes: true, attributeFilter: ["data-lang"] });
})();

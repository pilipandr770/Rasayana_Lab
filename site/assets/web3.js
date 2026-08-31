// Общий Web3-хелпер для страниц /token и /shop.
// Тестовая сеть Sepolia, контракт RasayanaMembership — non-transferable
// членский токен с прогрессивной кривой цены. Реальных денег здесь нет:
// оплата тестовым ETH, ноль монетарной стоимости.

const RASA_CONTRACT_ADDRESS = "0x2eff941e36D62c54B754dbd099b5726A2b29f226";
const SEPOLIA_CHAIN_ID_HEX = "0xaa36a7"; // 11155111

const TIER_LABELS = {
  0: { uk: "Немає токена", en: "No token", de: "Kein Token" },
  1: { uk: "Member", en: "Member", de: "Member" },
  2: { uk: "Silver", en: "Silver", de: "Silver" },
  3: { uk: "Gold", en: "Gold", de: "Gold" },
  4: { uk: "Platinum", en: "Platinum", de: "Platinum" },
  5: { uk: "Founding Member", en: "Founding Member", de: "Founding Member" },
};

let rasaProvider = null;
let rasaSigner = null;
let rasaContract = null;
let rasaReadContract = null;

// --- EIP-6963: обнаружение НЕСКОЛЬКИХ установленных кошельков (MetaMask,
// Coinbase Wallet и т.д.), чтобы дать пользователю выбрать нужный, а не
// зависеть от того, какое расширение "перехватило" window.ethereum первым.
const rasaDetectedProviders = new Map();
window.addEventListener("eip6963:announceProvider", (event) => {
  rasaDetectedProviders.set(event.detail.info.uuid, event.detail);
});
function rasaRequestProviders() {
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}
rasaRequestProviders();

function rasaCurLang() {
  return document.documentElement.getAttribute("data-lang") || "uk";
}

function rasaTr(uk, en, de) {
  const l = rasaCurLang();
  if (l === "uk") return uk;
  if (l === "de") return de || en;
  return en;
}

function rasaShowWalletPicker(providers) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(10,12,20,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;";

    const box = document.createElement("div");
    box.style.cssText = "background:#fff;color:#1A1D2B;border-radius:10px;padding:24px;min-width:280px;max-width:340px;width:100%;font-family:'PT Sans',Arial,sans-serif;box-shadow:0 20px 60px rgba(0,0,0,.3);";

    const title = document.createElement("div");
    title.textContent = rasaTr("Оберіть гаманець", "Choose a wallet", "Wallet auswählen");
    title.style.cssText = "font-weight:700;margin-bottom:16px;font-size:16px;";
    box.appendChild(title);

    providers.forEach(({ info, provider }) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.style.cssText = "display:flex;align-items:center;gap:10px;width:100%;padding:11px 14px;margin-bottom:8px;border:1px solid #DDD;border-radius:6px;background:#fff;cursor:pointer;font-size:14px;text-align:left;";
      btn.onmouseenter = () => { btn.style.borderColor = "#9C6A1B"; };
      btn.onmouseleave = () => { btn.style.borderColor = "#DDD"; };
      if (info.icon) {
        const img = document.createElement("img");
        img.src = info.icon;
        img.style.cssText = "width:24px;height:24px;border-radius:4px;flex:none;";
        btn.appendChild(img);
      }
      const label = document.createElement("span");
      label.textContent = info.name;
      btn.appendChild(label);
      btn.onclick = () => { document.body.removeChild(overlay); resolve(provider); };
      box.appendChild(btn);
    });

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = rasaTr("Скасувати", "Cancel", "Abbrechen");
    cancelBtn.style.cssText = "width:100%;padding:10px;margin-top:6px;border:none;background:transparent;color:#888;cursor:pointer;font-size:13px;";
    cancelBtn.onclick = () => { document.body.removeChild(overlay); resolve(null); };
    box.appendChild(cancelBtn);

    overlay.appendChild(box);
    overlay.onclick = (e) => { if (e.target === overlay) { document.body.removeChild(overlay); resolve(null); } };
    document.body.appendChild(overlay);
  });
}

const RASA_REMEMBER_KEY = "rasa_wallet_rdns";

async function rasaWaitForProviders() {
  rasaRequestProviders();
  await new Promise((r) => setTimeout(r, 350));
  return Array.from(rasaDetectedProviders.values());
}

async function rasaPickProvider() {
  const providers = await rasaWaitForProviders();

  if (providers.length >= 1) {
    // Показываем выбор всегда, даже если найден один кошелёк — чтобы было видно,
    // какое именно расширение будет использовано (некоторые конфликтуют между собой).
    const chosen = await rasaShowWalletPicker(providers);
    if (!chosen) {
      throw new Error(rasaTr("Підключення скасовано", "Connection cancelled", "Verbindung abgebrochen"));
    }
    const match = providers.find((p) => p.provider === chosen);
    if (match) {
      try { localStorage.setItem(RASA_REMEMBER_KEY, match.info.rdns); } catch (e) {}
    }
    return chosen;
  }
  if (window.ethereum) {
    return window.ethereum;
  }
  throw new Error(rasaTr(
    "Гаманець не знайдено. Встановіть розширення браузера (MetaMask, Coinbase Wallet тощо).",
    "No wallet found. Please install a browser wallet extension (MetaMask, Coinbase Wallet, etc.).",
    "Keine Wallet gefunden. Bitte installieren Sie eine Browser-Wallet-Erweiterung (MetaMask, Coinbase Wallet usw.)."
  ));
}

/// Тихая попытка восстановить подключение на новой странице — без всплывающих
/// окон. Срабатывает только если сайт уже был явно авторизован в этом кошельке
/// ранее (через eth_accounts, который не спрашивает разрешения повторно).
async function rasaTryAutoReconnect() {
  let rememberedRdns = null;
  try { rememberedRdns = localStorage.getItem(RASA_REMEMBER_KEY); } catch (e) {}
  if (!rememberedRdns) return null;

  const providers = await rasaWaitForProviders();
  const match = providers.find((p) => p.info.rdns === rememberedRdns);
  const injected = match ? match.provider : window.ethereum;
  if (!injected) return null;

  try {
    const accounts = await injected.request({ method: "eth_accounts" });
    if (!accounts || accounts.length === 0) return null;
    return await rasaFinishConnect(injected);
  } catch (e) {
    return null;
  }
}

async function rasaGetReadContract() {
  if (rasaReadContract) return rasaReadContract;
  const abiResp = await fetch("/assets/membership_abi.json");
  const abi = await abiResp.json();
  // публичный RPC для чтения без подключения кошелька
  const readProvider = new ethers.JsonRpcProvider("https://ethereum-sepolia-rpc.publicnode.com");
  rasaReadContract = new ethers.Contract(RASA_CONTRACT_ADDRESS, abi, readProvider);
  return rasaReadContract;
}

async function rasaFinishConnect(injected) {
  const abiResp = await fetch("/assets/membership_abi.json");
  const abi = await abiResp.json();

  rasaProvider = new ethers.BrowserProvider(injected);
  const network = await rasaProvider.getNetwork();
  if (network.chainId !== 11155111n) {
    try {
      await injected.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: SEPOLIA_CHAIN_ID_HEX }],
      });
    } catch (switchError) {
      if (switchError.code === 4902) {
        await injected.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: SEPOLIA_CHAIN_ID_HEX,
            chainName: "Sepolia",
            nativeCurrency: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 },
            rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com"],
            blockExplorerUrls: ["https://sepolia.etherscan.io"],
          }],
        });
      } else {
        throw switchError;
      }
    }
    rasaProvider = new ethers.BrowserProvider(injected);
  }

  rasaSigner = await rasaProvider.getSigner();
  rasaContract = new ethers.Contract(RASA_CONTRACT_ADDRESS, abi, rasaSigner);
  return rasaSigner.getAddress();
}

async function rasaConnectWallet() {
  const injected = await rasaPickProvider();

  rasaProvider = new ethers.BrowserProvider(injected);
  try {
    await rasaProvider.send("eth_requestAccounts", []);
  } catch (e) {
    const innerCode = e?.info?.error?.code ?? e?.error?.code ?? e?.code;
    if (innerCode === -32002) {
      throw new Error(rasaTr(
        "У гаманці вже є незавершений запит на підключення. Відкрийте розширення гаманця напряму (іконка на панелі браузера), підтвердьте або відхиліть його там, потім спробуйте знову.",
        "Your wallet already has a pending connection request. Open the wallet extension directly (toolbar icon), approve or dismiss it there, then try again.",
        "Ihre Wallet hat bereits eine ausstehende Verbindungsanfrage. Öffnen Sie die Wallet-Erweiterung direkt (Symbol in der Toolbar), bestätigen oder verwerfen Sie sie dort, und versuchen Sie es erneut."
      ));
    }
    throw e;
  }

  return rasaFinishConnect(injected);
}

async function rasaGetMemberInfo(address) {
  const contract = await rasaGetReadContract();
  const [balance, tier, discountBps] = await Promise.all([
    contract.balanceOf(address),
    contract.tierOf(address),
    contract.discountBps(address),
  ]);
  return {
    balance: Number(balance),
    tier: Number(tier),
    tierLabel: TIER_LABELS[Number(tier)][rasaCurLang()],
    discountPct: Number(discountBps) / 100,
  };
}

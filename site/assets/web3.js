// Общий Web3-хелпер для страниц /token и /shop.
// Тестовая сеть Sepolia, контракт RasayanaMembership — non-transferable
// членский токен с прогрессивной кривой цены. Реальных денег здесь нет:
// оплата тестовым ETH, ноль монетарной стоимости.

const RASA_CONTRACT_ADDRESS = "0xFEa77eAf7bE46ec845801eAE93dE6d156e223d49";
const SEPOLIA_CHAIN_ID_HEX = "0xaa36a7"; // 11155111

const TIER_LABELS = {
  0: { ru: "Нет токена", en: "No token" },
  1: { ru: "Member", en: "Member" },
  2: { ru: "Silver", en: "Silver" },
  3: { ru: "Gold", en: "Gold" },
  4: { ru: "Platinum", en: "Platinum" },
  5: { ru: "Founding Member", en: "Founding Member" },
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
  return document.documentElement.getAttribute("data-lang") || "ru";
}

function rasaShowWalletPicker(providers) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(10,12,20,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;";

    const box = document.createElement("div");
    box.style.cssText = "background:#fff;color:#1A1D2B;border-radius:10px;padding:24px;min-width:280px;max-width:340px;width:100%;font-family:'PT Sans',Arial,sans-serif;box-shadow:0 20px 60px rgba(0,0,0,.3);";

    const title = document.createElement("div");
    title.textContent = rasaCurLang() === "ru" ? "Выберите кошелёк" : "Choose a wallet";
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
    cancelBtn.textContent = rasaCurLang() === "ru" ? "Отмена" : "Cancel";
    cancelBtn.style.cssText = "width:100%;padding:10px;margin-top:6px;border:none;background:transparent;color:#888;cursor:pointer;font-size:13px;";
    cancelBtn.onclick = () => { document.body.removeChild(overlay); resolve(null); };
    box.appendChild(cancelBtn);

    overlay.appendChild(box);
    overlay.onclick = (e) => { if (e.target === overlay) { document.body.removeChild(overlay); resolve(null); } };
    document.body.appendChild(overlay);
  });
}

async function rasaPickProvider() {
  // Даём кошелькам время объявиться через EIP-6963 (некоторым расширениям нужно чуть больше времени)
  rasaRequestProviders();
  await new Promise((r) => setTimeout(r, 350));

  const providers = Array.from(rasaDetectedProviders.values());

  if (providers.length >= 1) {
    // Показываем выбор всегда, даже если найден один кошелёк — чтобы было видно,
    // какое именно расширение будет использовано (некоторые конфликтуют между собой).
    const chosen = await rasaShowWalletPicker(providers);
    if (!chosen) {
      throw new Error(rasaCurLang() === "ru" ? "Подключение отменено" : "Connection cancelled");
    }
    return chosen;
  }
  if (window.ethereum) {
    return window.ethereum;
  }
  throw new Error(rasaCurLang() === "ru"
    ? "Не найден кошелёк. Установите расширение браузера (MetaMask, Coinbase Wallet и т.п.)."
    : "No wallet found. Please install a browser wallet extension (MetaMask, Coinbase Wallet, etc.).");
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

async function rasaConnectWallet() {
  const injected = await rasaPickProvider();

  const abiResp = await fetch("/assets/membership_abi.json");
  const abi = await abiResp.json();

  rasaProvider = new ethers.BrowserProvider(injected);
  try {
    await rasaProvider.send("eth_requestAccounts", []);
  } catch (e) {
    if (e && e.error && e.error.code === -32002) {
      throw new Error(rasaCurLang() === "ru"
        ? "В кошельке уже есть незавершённый запрос на подключение. Откройте расширение кошелька напрямую (иконка в панели браузера), подтвердите или отклоните его там, затем попробуйте снова."
        : "Your wallet already has a pending connection request. Open the wallet extension directly (toolbar icon), approve or dismiss it there, then try again.");
    }
    throw e;
  }

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

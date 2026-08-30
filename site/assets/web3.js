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

function rasaCurLang() {
  return document.documentElement.getAttribute("data-lang") || "ru";
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
  if (!window.ethereum) {
    throw new Error(rasaCurLang() === "ru"
      ? "Не найден кошелёк (MetaMask). Установите расширение браузера MetaMask."
      : "No wallet found (MetaMask). Please install the MetaMask browser extension.");
  }
  const abiResp = await fetch("/assets/membership_abi.json");
  const abi = await abiResp.json();

  rasaProvider = new ethers.BrowserProvider(window.ethereum);
  await rasaProvider.send("eth_requestAccounts", []);

  const network = await rasaProvider.getNetwork();
  if (network.chainId !== 11155111n) {
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: SEPOLIA_CHAIN_ID_HEX }],
      });
    } catch (switchError) {
      if (switchError.code === 4902) {
        await window.ethereum.request({
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
    rasaProvider = new ethers.BrowserProvider(window.ethereum);
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

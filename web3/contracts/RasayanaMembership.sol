// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title Rasayana Founding Member — non-transferable membership token
/// @notice ДЕМО-контракт для тестовой сети. Не является финансовым инструментом:
///         не имеет цены на вторичном рынке (нетрансферабелен), не хранит и не
///         обменивается на деньги, служит только пропуском к скидке/приоритету
///         в собственном магазине компании. Оплата — тестовым ETH, без реальной
///         денежной стоимости.
contract RasayanaMembership {
    string public constant name = "Rasayana Founding Member";
    string public constant symbol = "RASA-FM";
    uint8 public constant decimals = 0;

    mapping(address => uint256) public balanceOf;
    mapping(address => bool) public hasClaimedFree;
    uint256 public totalSupply;

    // Прогрессивная кривая цены: цена n-го токена = basePrice * (growthRateBps/10000)^(n-2)
    // Токен №1 — бесплатный клейм. growthRateBps=11000 значит +10% за каждый следующий токен.
    uint256 public basePrice = 0.001 ether;
    uint256 public growthRateBps = 11000;
    uint256 public maxPerWallet = 100;

    // Скидка: 1% за токен, капа настраивается владельцем (обсуждалось 20-30%)
    uint256 public discountCapBps = 2500; // 25% по умолчанию

    address public owner;
    uint256 public collected;

    event Claimed(address indexed member);
    event Purchased(address indexed member, uint256 quantity, uint256 cost, uint256 newBalance);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    // --- Соулбаунд: намеренно НЕТ transfer/transferFrom/approve ---
    // Токен нельзя продать или передать — это ключевое регуляторное решение проекта.

    function claimFree() external {
        require(!hasClaimedFree[msg.sender], "already claimed");
        hasClaimedFree[msg.sender] = true;
        balanceOf[msg.sender] += 1;
        totalSupply += 1;
        emit Claimed(msg.sender);
    }

    /// @notice Цена именно n-го токена в кошельке (n>=2, т.к. 1-й бесплатный)
    function priceForNth(uint256 n) public view returns (uint256 price) {
        require(n >= 2, "first token is free");
        price = basePrice;
        for (uint256 i = 0; i < n - 2; i++) {
            price = (price * growthRateBps) / 10000;
        }
    }

    /// @notice Сколько будет стоить купить `quantity` следующих токенов для `wallet`
    function quoteCost(address wallet, uint256 quantity) public view returns (uint256 totalCost) {
        uint256 current = balanceOf[wallet];
        require(current > 0, "claim your free token first");
        for (uint256 i = 0; i < quantity; i++) {
            totalCost += priceForNth(current + 1 + i);
        }
    }

    function buy(uint256 quantity) external payable {
        require(quantity > 0, "quantity=0");
        require(balanceOf[msg.sender] > 0, "claim your free token first");
        require(balanceOf[msg.sender] + quantity <= maxPerWallet, "exceeds max per wallet");
        uint256 cost = quoteCost(msg.sender, quantity);
        require(msg.value >= cost, "insufficient payment");

        balanceOf[msg.sender] += quantity;
        totalSupply += quantity;
        collected += cost;
        emit Purchased(msg.sender, quantity, cost, balanceOf[msg.sender]);

        if (msg.value > cost) {
            payable(msg.sender).transfer(msg.value - cost);
        }
    }

    /// @notice Скидка в базисных пунктах (100 = 1%), капается discountCapBps
    function discountBps(address wallet) public view returns (uint256) {
        uint256 bal = balanceOf[wallet];
        uint256 raw = bal * 100;
        return raw > discountCapBps ? discountCapBps : raw;
    }

    /// @notice Уровень доступа: 0=нет токена, 1=Member(1-4), 2=Silver(5-19), 3=Gold(20-49), 4=Platinum(50-99), 5=Founding(100+)
    function tierOf(address wallet) public view returns (uint8) {
        uint256 bal = balanceOf[wallet];
        if (bal == 0) return 0;
        if (bal < 5) return 1;
        if (bal < 20) return 2;
        if (bal < 50) return 3;
        if (bal < 100) return 4;
        return 5;
    }

    function setDiscountCapBps(uint256 newCapBps) external onlyOwner {
        require(newCapBps <= 3000, "cap too high"); // жёсткий потолок 30%, обсуждённый в питче
        discountCapBps = newCapBps;
    }

    function setCurve(uint256 newBasePrice, uint256 newGrowthRateBps) external onlyOwner {
        basePrice = newBasePrice;
        growthRateBps = newGrowthRateBps;
    }

    function withdraw() external onlyOwner {
        payable(owner).transfer(address(this).balance);
    }
}

import { useState, useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import './BuyerCalculator.css';

// System parameters (constants)
interface SystemParams {
  CB_base: number; // Base cashback percentage
  alpha: number; // Cashback degradation coefficient
  beta: number; // Quality factor coefficient
  gamma: number; // Diminishing returns coefficient
  P0: number; // Initial token price
  k: number; // Bonding curve coefficient
  discount_base: number; // Base discount percentage
  theta: number; // Discount degradation coefficient
  burn_cap: number; // Burn cap per year
  access_fee: number; // Access fee
  user_cap: number; // User token cap
  t_launch: number; // Launch time
}

// User input parameters
interface UserInputs {
  purchasePrice: number; // Pi - purchase price
  numberOfPurchases: number; // Number of purchases
  period: number; // t - time period
  reviewQuality: number; // review_quality (0-1)
  returnProbability: number; // return_probability (0-1)
}

// Market simulation constants
const ASSUMED_USERS = 100; // Number of similar users for global supply estimation
const ASSUMED_BURN_RATE = 0.3; // Assumed burn rate (30% of minted tokens are burned)
const INITIAL_GLOBAL_MINTED = 10000; // Initial global token supply before user's purchases

// Default system parameters
const DEFAULT_SYSTEM_PARAMS: SystemParams = {
  CB_base: 0.05, // 5% base cashback
  alpha: 0.01, // 1% degradation per period
  beta: 0.3, // Quality factor coefficient
  gamma: 0.5, // Diminishing returns coefficient
  P0: 1.0, // Initial token price = 1
  k: 0.0001, // Bonding curve coefficient
  discount_base: 0.1, // 10% base discount
  theta: 0.006, // 0.6% discount degradation
  burn_cap: 1000000, // 1M tokens burn cap per year
  access_fee: 10, // 10 tokens access fee
  user_cap: 10000, // 10K tokens user cap
  t_launch: 0, // Launch time = 0
};

export default function BuyerCalculator() {
  // User inputs state
  const [userInputs, setUserInputs] = useState<UserInputs>({
    purchasePrice: 10000,
    numberOfPurchases: 7,
    period: 1,
    reviewQuality: 0.8,
    returnProbability: 0.1,
  });

  // Validation errors state
  const [errors, setErrors] = useState<Partial<Record<keyof UserInputs, string>>>({});

  // System parameters state (can be made editable later)
  const [systemParams] = useState<SystemParams>(DEFAULT_SYSTEM_PARAMS);

  // Validation function
  const validateInput = (field: keyof UserInputs, value: number): string | null => {
    switch (field) {
      case 'purchasePrice':
        if (isNaN(value) || value < 0) {
          return 'Цена покупки должна быть положительным числом';
        }
        return null;
      case 'numberOfPurchases':
        if (isNaN(value) || value < 1 || !Number.isInteger(value)) {
          return 'Количество покупок должно быть целым числом не менее 1';
        }
        return null;
      case 'period':
        if (isNaN(value) || value < 0) {
          return 'Период должен быть неотрицательным числом';
        }
        return null;
      case 'reviewQuality':
        if (isNaN(value) || value < 0 || value > 1) {
          return 'Качество отзывов должно быть числом от 0 до 1';
        }
        return null;
      case 'returnProbability':
        if (isNaN(value) || value < 0 || value > 1) {
          return 'Вероятность возврата должна быть числом от 0 до 1';
        }
        return null;
      default:
        return null;
    }
  };

  // Handle input change with validation
  const handleInputChange = (field: keyof UserInputs, value: string) => {
    // Handle empty input
    if (value === '') {
      setErrors((prev) => ({
        ...prev,
        [field]: undefined,
      }));
      return;
    }

    // Parse value based on field type
    const numValue = field === 'numberOfPurchases' 
      ? parseInt(value, 10) 
      : parseFloat(value);
    
    const error = validateInput(field, numValue);
    
    setErrors((prev) => ({
      ...prev,
      [field]: error || undefined,
    }));

    // Update value if valid
    if (!error && !isNaN(numValue)) {
      setUserInputs((prev) => ({
        ...prev,
        [field]: numValue,
      }));
    }
  };

  // Handle blur - correct value if invalid
  const handleBlur = (field: keyof UserInputs) => {
    const currentValue = userInputs[field];
    const error = validateInput(field, currentValue);
    
    if (error) {
      // Correct value based on field
      let correctedValue = currentValue;
      switch (field) {
        case 'reviewQuality':
        case 'returnProbability':
          correctedValue = Math.max(0, Math.min(1, currentValue));
          break;
        case 'numberOfPurchases':
          correctedValue = Math.max(1, Math.floor(currentValue));
          break;
        case 'purchasePrice':
        case 'period':
          correctedValue = Math.max(0, currentValue);
          break;
      }
      
      setUserInputs((prev) => ({
        ...prev,
        [field]: correctedValue,
      }));
      setErrors((prev) => ({
        ...prev,
        [field]: undefined,
      }));
    }
  };

  // Calculate CB%(t) - Cashback percentage at time t
  const calculateCashbackPercent = (t: number, params: SystemParams): number => {
    return Math.max(0, params.CB_base * (1 - params.alpha * (t - params.t_launch)));
  };

  // Calculate QFi - Quality factor for purchase i
  const calculateQualityFactor = (
    returnProbability: number,
    reviewQuality: number,
    params: SystemParams
  ): number => {
    return 1 + params.beta * (1 - returnProbability) * reviewQuality;
  };

  // Calculate DF(t) - Diminishing factor at time t
  const calculateDiminishingFactor = (
    totalMintedUser: number,
    params: SystemParams
  ): number => {
    return Math.exp(-params.gamma * (totalMintedUser / params.user_cap));
  };

  // Calculate Ptoken(t) - Token price at time t
  const calculateTokenPrice = (
    totalMinted: number,
    params: SystemParams
  ): number => {
    return params.P0 * (1 + params.k * totalMinted ** 2);
  };

  // Calculate discount%(t) - Discount percentage at time t
  const calculateDiscountPercent = (
    burnedYear: number,
    params: SystemParams
  ): number => {
    return Math.max(0, params.discount_base * (1 - params.theta * (burnedYear / params.burn_cap)));
  };

  // Calculate minted tokens for user
  const calculateMintedTokens = (
    inputs: UserInputs,
    params: SystemParams,
    globalTotalMinted: number
  ): { 
    totalMintedUser: number; 
    newGlobalTotalMinted: number;
    dfFirst: number;
    dfLast: number;
    mintedPerPurchaseAvg: number;
  } => {
    let currentGlobalTotalMinted = globalTotalMinted;
    let totalMintedUser = 0;

    // Use integer period for consistency across all calculations
    const t = Math.floor(inputs.period);
    
    // Calculate DF at the start (when minted = 0)
    const dfFirst = calculateDiminishingFactor(0, params);
    
    for (let i = 0; i < inputs.numberOfPurchases; i++) {
      const CB_percent = calculateCashbackPercent(t, params);
      const QFi = calculateQualityFactor(
        inputs.returnProbability,
        inputs.reviewQuality,
        params
      );
      const DF = calculateDiminishingFactor(totalMintedUser, params);
      const Ptoken = calculateTokenPrice(currentGlobalTotalMinted, params);

      const mintedForPurchase =
        (inputs.purchasePrice * CB_percent * QFi * DF) / Ptoken;

      currentGlobalTotalMinted += mintedForPurchase;
      totalMintedUser += mintedForPurchase;
    }

    // Calculate DF at the end (after all purchases)
    const dfLast = calculateDiminishingFactor(totalMintedUser, params);
    const mintedPerPurchaseAvg = totalMintedUser / inputs.numberOfPurchases;

    return {
      totalMintedUser,
      newGlobalTotalMinted: currentGlobalTotalMinted,
      dfFirst,
      dfLast,
      mintedPerPurchaseAvg,
    };
  };

  // Calculate burned tokens for user
  const calculateBurnedTokens = (
    inputs: UserInputs,
    params: SystemParams,
    burnedYear: number,
    tokenPrice: number
  ): number => {
    const discount_percent = calculateDiscountPercent(burnedYear, params);
    let totalBurned = 0;

    for (let i = 0; i < inputs.numberOfPurchases; i++) {
      // Convert discount in rubles to tokens using current token price
      const discountInRubles = inputs.purchasePrice * discount_percent;
      const burnedForPurchase = discountInRubles / tokenPrice;
      totalBurned += burnedForPurchase;
    }

    // access_fee is a fixed fee in tokens (not dependent on token price)
    return totalBurned + params.access_fee;
  };

  // Calculate results
  const results = useMemo(() => {
    // Use initial global total minted (simplified - in real scenario this would be global state)
    const initialGlobalTotalMinted = INITIAL_GLOBAL_MINTED;
    
    // Use integer period for consistency
    const t = Math.floor(userInputs.period);
    
    // Calculate minted tokens using global total minted
    const mintResult = calculateMintedTokens(
      userInputs,
      systemParams,
      initialGlobalTotalMinted
    );
    
    const totalMintedUser = mintResult.totalMintedUser;
    
    // Update global total considering all similar users
    // Formula: newGlobalTotalMinted = initialGlobalTotalMinted + (totalMintedUser * ASSUMED_USERS)
    const newGlobalTotalMinted = initialGlobalTotalMinted + (totalMintedUser * ASSUMED_USERS);
    
    // Calculate token price based on the updated global total minted
    const tokenPrice = calculateTokenPrice(newGlobalTotalMinted, systemParams);
    
    // Estimate market burned tokens for discount calculation
    // Formula: assumedMarketBurnedYearTokens = totalMintedUser * ASSUMED_BURN_RATE * ASSUMED_USERS
    const assumedMarketBurnedYearTokens = totalMintedUser * ASSUMED_BURN_RATE * ASSUMED_USERS;
    const totalBurned = calculateBurnedTokens(
      userInputs,
      systemParams,
      assumedMarketBurnedYearTokens,
      tokenPrice
    );

    const burnDestroyed = totalBurned * 0.7; // 70% destroyed
    const burnRedistributed = totalBurned * 0.3; // 30% redistributed to sellers

    // Calculate intermediate values for breakdown
    const CB_percent = calculateCashbackPercent(t, systemParams);
    const QF = calculateQualityFactor(userInputs.returnProbability, userInputs.reviewQuality, systemParams);
    const capUsage = totalMintedUser / systemParams.user_cap;
    const discount_percent = calculateDiscountPercent(assumedMarketBurnedYearTokens, systemParams);
    const discountRubTotal = userInputs.purchasePrice * userInputs.numberOfPurchases * discount_percent;
    const burnDiscountTokens = discountRubTotal / tokenPrice;
    const accessFeeTokens = systemParams.access_fee;
    const netValueRub = (totalMintedUser - totalBurned) * tokenPrice;
    const effectiveCashbackRub = totalMintedUser * tokenPrice;
    const effectiveDiscountRub = totalBurned * tokenPrice;

    return {
      totalMintedUser,
      tokenPrice,
      totalBurned,
      burnDestroyed,
      burnRedistributed,
      netTokens: totalMintedUser - totalBurned,
      // Breakdown values
      breakdown: {
        // Mint breakdown
        t,
        CB_percent,
        QF,
        dfFirst: mintResult.dfFirst,
        dfLast: mintResult.dfLast,
        mintedPerPurchaseAvg: mintResult.mintedPerPurchaseAvg,
        capUsage,
        // Burn breakdown
        discount_percent,
        discountRubTotal,
        burnDiscountTokens,
        accessFeeTokens,
        // Interpretation
        netValueRub,
        effectiveCashbackRub,
        effectiveDiscountRub,
        // Assumptions
        initialGlobalTotalMinted,
        assumedUsers: ASSUMED_USERS,
        assumedBurnRate: ASSUMED_BURN_RATE,
        newGlobalTotalMinted,
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userInputs, systemParams]);

  // Generate chart data for bonding curve
  const bondingCurveData = useMemo(() => {
    const data = [];
    for (let totalMinted = 0; totalMinted <= 100000; totalMinted += 1000) {
      const price = calculateTokenPrice(totalMinted, systemParams);
      data.push({
        totalMinted,
        price: price,
      });
    }
    return data;
  }, [systemParams]);

  // Burn mechanism pie chart data
  const burnPieData = [
    { name: 'Уничтожено (70%)', value: results.burnDestroyed },
    { name: 'Перераспределено продавцам (30%)', value: results.burnRedistributed },
  ];

  const COLORS = ['#8884d8', '#82ca9d'];

  return (
    <div className="buyer-calculator">
      <div className="calculator-header">
        <h1>Калькулятор токеномики для покупателей (B2C)</h1>
        <p className="description">
          Этот калькулятор поможет вам рассчитать количество токенов, которые вы получите
          за покупки (эмиссия) и сможете использовать для получения скидок (утилизация).
        </p>
      </div>

      <div className="calculator-content">
        <div className="main-sections">
          <div className="input-section">
            <h2>Параметры ваших действий</h2>
            <p className="section-description">
              Введите данные о ваших покупках и активности на платформе:
            </p>

          <div className="input-group">
            <label htmlFor="purchasePrice">
              Цена покупки (₽) <span className="required">*</span>
            </label>
            <input
              id="purchasePrice"
              type="number"
              min="0"
              step="100"
              value={userInputs.purchasePrice}
              onChange={(e) => handleInputChange('purchasePrice', e.target.value)}
              onBlur={() => handleBlur('purchasePrice')}
              className={errors.purchasePrice ? 'input-error' : ''}
            />
            {errors.purchasePrice && (
              <span className="error-message">{errors.purchasePrice}</span>
            )}
            <span className="input-hint">
              Средняя стоимость одной покупки в рублях
            </span>
          </div>

          <div className="input-group">
            <label htmlFor="numberOfPurchases">
              Количество покупок <span className="required">*</span>
            </label>
            <input
              id="numberOfPurchases"
              type="number"
              min="1"
              value={userInputs.numberOfPurchases}
              onChange={(e) => handleInputChange('numberOfPurchases', e.target.value)}
              onBlur={() => handleBlur('numberOfPurchases')}
              className={errors.numberOfPurchases ? 'input-error' : ''}
            />
            {errors.numberOfPurchases && (
              <span className="error-message">{errors.numberOfPurchases}</span>
            )}
            <span className="input-hint">
              Сколько покупок вы планируете совершить
            </span>
          </div>

          <div className="input-group">
            <label htmlFor="period">
              Период (время с момента запуска) <span className="required">*</span>
            </label>
            <div className="slider-container">
              <input
                id="period"
                type="range"
                min="0"
                max="20"
                step="1"
                value={userInputs.period}
                onChange={(e) => {
                  const value = parseFloat(e.target.value);
                  const percentage = (value / 20) * 100;
                  e.target.style.setProperty('--slider-progress', `${percentage}%`);
                  setUserInputs((prev) => ({ ...prev, period: value }));
                }}
                onInput={(e) => {
                  const value = parseFloat((e.target as HTMLInputElement).value);
                  const percentage = (value / 20) * 100;
                  (e.target as HTMLInputElement).style.setProperty('--slider-progress', `${percentage}%`);
                }}
                style={{ '--slider-progress': `${(userInputs.period / 20) * 100}%` } as React.CSSProperties}
                className={errors.period ? 'slider-error' : ''}
              />
              <span className="slider-value">{Math.floor(userInputs.period)}</span>
            </div>
            {errors.period && (
              <span className="error-message">{errors.period}</span>
            )}
            <span className="input-hint">
              Временной период с момента запуска платформы (в условных единицах)
            </span>
          </div>

          <div className="input-group">
            <label htmlFor="reviewQuality">
              Качество отзывов (0-1) <span className="required">*</span>
            </label>
            <div className="slider-container">
              <input
                id="reviewQuality"
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={userInputs.reviewQuality}
                onChange={(e) => {
                  const value = parseFloat(e.target.value);
                  const percentage = (value / 1) * 100;
                  e.target.style.setProperty('--slider-progress', `${percentage}%`);
                  setUserInputs((prev) => ({ ...prev, reviewQuality: value }));
                }}
                onInput={(e) => {
                  const value = parseFloat((e.target as HTMLInputElement).value);
                  const percentage = (value / 1) * 100;
                  (e.target as HTMLInputElement).style.setProperty('--slider-progress', `${percentage}%`);
                }}
                style={{ '--slider-progress': `${(userInputs.reviewQuality / 1) * 100}%` } as React.CSSProperties}
                className={errors.reviewQuality ? 'slider-error' : ''}
              />
              <span className="slider-value">{(userInputs.reviewQuality * 100).toFixed(1)}%</span>
            </div>
            {errors.reviewQuality && (
              <span className="error-message">{errors.reviewQuality}</span>
            )}
            <span className="input-hint">
              Оценка качества ваших отзывов (0 = плохо, 1 = отлично)
            </span>
          </div>

          <div className="input-group">
            <label htmlFor="returnProbability">
              Вероятность возврата (0-1) <span className="required">*</span>
            </label>
            <div className="slider-container">
              <input
                id="returnProbability"
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={userInputs.returnProbability}
                onChange={(e) => {
                  const value = parseFloat(e.target.value);
                  const percentage = (value / 1) * 100;
                  e.target.style.setProperty('--slider-progress', `${percentage}%`);
                  setUserInputs((prev) => ({ ...prev, returnProbability: value }));
                }}
                onInput={(e) => {
                  const value = parseFloat((e.target as HTMLInputElement).value);
                  const percentage = (value / 1) * 100;
                  (e.target as HTMLInputElement).style.setProperty('--slider-progress', `${percentage}%`);
                }}
                style={{ '--slider-progress': `${(userInputs.returnProbability / 1) * 100}%` } as React.CSSProperties}
                className={errors.returnProbability ? 'slider-error' : ''}
              />
              <span className="slider-value">{(userInputs.returnProbability * 100).toFixed(1)}%</span>
            </div>
            {errors.returnProbability && (
              <span className="error-message">{errors.returnProbability}</span>
            )}
            <span className="input-hint">
              Вероятность возврата товара (0 = никогда не возвращаете, 1 = всегда возвращаете)
            </span>
          </div>
        </div>

        <div className="results-section">
          <h2>Результаты расчетов</h2>

          <div className="results-grid">
            <div className="result-card">
              <h3>Эмиссия токенов</h3>
              <div className="result-value">
                {results.totalMintedUser.toFixed(2)}
              </div>
              <p className="result-description">
                Количество токенов, которые вы получите за ваши покупки
              </p>
            </div>

            <div className="result-card">
              <h3>Цена токена</h3>
              <div className="result-value">
                {results.tokenPrice.toFixed(4)} ₽
              </div>
              <p className="result-description">
                Текущая цена токена на основе bonding curve
              </p>
            </div>

            <div className="result-card">
              <h3>Утилизация токенов</h3>
              <div className="result-value">
                {results.totalBurned.toFixed(2)}
              </div>
              <p className="result-description">
                Количество токенов, которые вы потратите на скидки и доступ
              </p>
            </div>

            <div className="result-card">
              <h3>Чистый баланс</h3>
              <div className="result-value">
                {results.netTokens.toFixed(2)}
              </div>
              <p className="result-description">
                Итоговое количество токенов после эмиссии и утилизации
              </p>
            </div>
          </div>

          <div className="burn-mechanism">
            <h3>Механизм сжигания токенов</h3>
            <div className="burn-stats">
              <div className="burn-stat">
                <span className="burn-label">Уничтожено (70%):</span>
                <span className="burn-value">{results.burnDestroyed.toFixed(2)}</span>
              </div>
              <div className="burn-stat">
                <span className="burn-label">Перераспределено продавцам (30%):</span>
                <span className="burn-value">{results.burnRedistributed.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>
        </div>

        <div className="details-section">
          <h2>Промежуточные шаги расчёта</h2>
          
          <div className="breakdown-grid">
            <div className="breakdown-block">
              <h4>Эмиссия (mint)</h4>
              <div className="breakdown-table">
                <div className="breakdown-row">
                  <span className="breakdown-label">Период t:</span>
                  <span className="breakdown-value">{results.breakdown.t}</span>
                </div>
                <div className="breakdown-row">
                  <span className="breakdown-label">Cashback CB%(t):</span>
                  <span className="breakdown-value">{(results.breakdown.CB_percent * 100).toFixed(2)}%</span>
                </div>
                <div className="breakdown-row">
                  <span className="breakdown-label">Quality factor QF:</span>
                  <span className="breakdown-value">{results.breakdown.QF.toFixed(3)}</span>
                </div>
                <div className="breakdown-row">
                  <span className="breakdown-label">DF (первая покупка):</span>
                  <span className="breakdown-value">{results.breakdown.dfFirst.toFixed(4)}</span>
                </div>
                <div className="breakdown-row">
                  <span className="breakdown-label">DF (последняя покупка):</span>
                  <span className="breakdown-value">{results.breakdown.dfLast.toFixed(4)}</span>
                </div>
                <div className="breakdown-row">
                  <span className="breakdown-label">Mint / покупка:</span>
                  <span className="breakdown-value">{results.breakdown.mintedPerPurchaseAvg.toFixed(4)}</span>
                </div>
                <div className="breakdown-row">
                  <span className="breakdown-label">Использование user_cap:</span>
                  <span className="breakdown-value">{(results.breakdown.capUsage * 100).toFixed(2)}%</span>
                </div>
              </div>
            </div>

            <div className="breakdown-block">
              <h4>Утилизация (burn)</h4>
              <div className="breakdown-table">
                <div className="breakdown-row">
                  <span className="breakdown-label">Discount %:</span>
                  <span className="breakdown-value">{(results.breakdown.discount_percent * 100).toFixed(2)}%</span>
                </div>
                <div className="breakdown-row">
                  <span className="breakdown-label">Скидка в рублях (всего):</span>
                  <span className="breakdown-value">{results.breakdown.discountRubTotal.toFixed(2)} ₽</span>
                </div>
                <div className="breakdown-row">
                  <span className="breakdown-label">Burn за скидку (tokens):</span>
                  <span className="breakdown-value">{results.breakdown.burnDiscountTokens.toFixed(4)}</span>
                </div>
                <div className="breakdown-row">
                  <span className="breakdown-label">Access fee (tokens):</span>
                  <span className="breakdown-value">{results.breakdown.accessFeeTokens.toFixed(2)}</span>
                </div>
                <div className="breakdown-row">
                  <span className="breakdown-label">Итого burn (tokens):</span>
                  <span className="breakdown-value">{results.totalBurned.toFixed(4)}</span>
                </div>
              </div>
            </div>

            <div className="breakdown-block">
              <h4>Интерпретация</h4>
              <div className="breakdown-table">
                <div className="breakdown-row">
                  <span className="breakdown-label">Net в рублях:</span>
                  <span className="breakdown-value">{results.breakdown.netValueRub.toFixed(2)} ₽</span>
                </div>
                <div className="breakdown-row">
                  <span className="breakdown-label">Эффективный кэшбек в рублях:</span>
                  <span className="breakdown-value">{results.breakdown.effectiveCashbackRub.toFixed(2)} ₽</span>
                </div>
                <div className="breakdown-row">
                  <span className="breakdown-label">Эффективная "стоимость" утилизации:</span>
                  <span className="breakdown-value">{results.breakdown.effectiveDiscountRub.toFixed(2)} ₽</span>
                </div>
              </div>
            </div>

            <div className="breakdown-block">
              <h4>Допущения</h4>
              <div className="breakdown-table">
                <div className="breakdown-row">
                  <span className="breakdown-label">INITIAL_GLOBAL_MINTED:</span>
                  <span className="breakdown-value">{results.breakdown.initialGlobalTotalMinted}</span>
                </div>
                <div className="breakdown-row">
                  <span className="breakdown-label">ASSUMED_USERS:</span>
                  <span className="breakdown-value">{results.breakdown.assumedUsers}</span>
                </div>
                <div className="breakdown-row">
                  <span className="breakdown-label">ASSUMED_BURN_RATE:</span>
                  <span className="breakdown-value">{(results.breakdown.assumedBurnRate * 100).toFixed(0)}%</span>
                </div>
                <div className="breakdown-row">
                  <span className="breakdown-label">GLOBAL_TOTAL_MINTED_AFTER:</span>
                  <span className="breakdown-value">{results.breakdown.newGlobalTotalMinted.toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>

          <p className="breakdown-note">
            Промежуточные коэффициенты показывают, какие факторы влияют на эмиссию и утилизацию: cashback и качество увеличивают mint, а высокая цена токена по bonding curve уменьшает mint и увеличивает стоимость утилизации в токенах.
          </p>
        </div>

        <div className="charts-section">
          <h2>Визуализация</h2>

          <div className="chart-container">
            <h3>Bonding Curve (цена токена)</h3>
            <ResponsiveContainer width="100%" height={350}>
              <LineChart data={bondingCurveData} margin={{ top: 10, right: 30, left: 80, bottom: 100 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="totalMinted"
                  padding={{ left: 0, right: 0 }}
                  label={{ value: 'Общее количество заминченных токенов', position: 'insideBottom', offset: -5, style: { textAnchor: 'middle' } }}
                />
                <YAxis 
                  label={{ value: 'Цена токена (₽)', angle: -90, position: 'insideLeft', offset: -10, style: { textAnchor: 'middle' } }} 
                />
                <Tooltip />
                <Legend wrapperStyle={{ paddingTop: '20px' }} />
                <Line
                  type="monotone"
                  dataKey="price"
                  stroke="#82ca9d"
                  name="Цена токена"
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="chart-container">
            <h3>Распределение сжигания токенов</h3>
            <ResponsiveContainer width="100%" height={350}>
              <PieChart>
                <Pie
                  data={burnPieData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name}: ${((percent ?? 0) * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {burnPieData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend wrapperStyle={{ paddingTop: '20px' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}


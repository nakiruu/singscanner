# Optimal Trading Theory and

# Generalized Optimal Action

# Theory and Singularity

#### Theoretical Foundation and Applied Execution Model

```
Author: Kenneth Reed Bialousz (to be: Reed Armstrong)
Date: June 23, 2026
```
```
A brokerage-agnostic specification for after-cost portfolio control.
```

## Optimal Trading Theory and

## Generalized Optimal Action Theory

## and Singularity

Author: Kenneth Reed Bialousz (to be: Reed Armstrong)

Date: June 23, 2026

This document describes the trading theory an applied trading system is intended to follow. It is a
theory specification: signals, objective functions, constraints, costs, decision rules, and learning
targets.

The purpose is to describe, as a mathematical method, how the system should:

1. Estimate the optimal portfolio holdings.
2. Decide whether to trade now, wait, hold, rotate, exit, or repair an order.
3. Account for all costs that turn a paper edge into real after-cost return.
4. Apply one consistent optimization criterion: maximize expected after-cost
compounded return.

The phrase "optimal" means optimal under the current information set, model, constraints, and
execution venue. It does not mean the market is solved or that returns are guaranteed. It means the
system should choose the action with the highest modeled expected after-cost portfolio value among
the actions available to it.

### Scope And Constraints

This paper defines optimal trading under a specific set of practical constraints. The word "optimal"
should be read as conditional on these constraints, not as an unbounded claim about every possible
trading instrument, broker, data source, or execution venue.

The assumed execution venue is a consumer-level brokerage account accessed through a brokerage
API. The strategy must therefore account for real logistical hurdles that affect whether paper edge
becomes capturable return, including consumer-level order priority, broker order-routing behavior,
partial-fill risk, rejected or stale orders, quote and account-data freshness, API rate limits, extended-
hours liquidity, available order types, whole-share constraints where applicable, and the delay
between signal observation, order submission, broker acceptance, and actual fill.

The strategy is restricted to long securities and cash funded from account cash:

```
No options trading.
No short selling.
```

```
No derivatives, synthetic exposure, or position sizing that creates exposure
above available cash.
```
The predictive model is also restricted to the fundamental-analysis and technical-analysis variables
listed in this document. Additional information outside this feature set, such as higher-quality event
data, better real-time microstructure data, alternative data, improved fundamentals, options-market
signals, or more accurate news/semantic context, could improve predictive capacity if it adds causal
signal rather than noise. Those external inputs are not assumed by the equations below unless
explicitly added to the feature set and validated through the same after-cost replay process.

### 1. The Core Problem

At every decision time t, the system observes a state:

```
St =
market data
account data
positions
cash
cash available to trade
open orders
live quotes
candidate securities
signal inputs
execution constraints
calendar/session state
recent fill/slippage history
```
The system must choose an action:


```
At ∈ {
hold current portfolio,
buy one or more securities,
sell one or more securities,
rotate from current holdings to better holdings,
stay in cash,
wait for a better execution window,
modify an order,
cancel an order,
repair an account/order state
}
```
The theoretically correct choice is:

```
A*t = arg maxA 𝔼[ U(Wt+H) ∣ St, A ] - TotalCost(A ∣ St)
```
where:

```
Wt+H = future wealth at horizon H
U(.) = utility function aligned with compounded return
H = forecast / holding horizon
```
For maximizing real account growth, the preferred utility is geometric:

```
U(W) = log(W)
```
The reason is that trading performance compounds. A strategy with higher average single-period
return can still lose to a strategy with lower average return if it has worse drawdowns, volatility drag,
or ruin risk. Therefore, the system should not maximize raw expected return alone. It should
maximize expected after-cost geometric growth.

In practical approximation:

```
Expected log growth =
expected portfolio return
```
- volatility drag
- transaction costs
- uncertainty costs
- operational costs

For a candidate portfolio weight vector w:


```
G(w) =
w′ · μ
```
- 0. 5 · γrisk(t) · w′ · Σrisk(t) · w
+ λconfirm(t) · w′ · Σconfirm(t) · w
- Ctransition(wcurrent → w)
- Cfuture exit(w)
- Cuncertainty(w)
- Cliquidity(w)
- Cconcentration(w)
- Ccarry(w)
- Coperational(w)

The optimal holding is:

```
w* = arg maxw G(w)
```
subject to:

```
∑i wi + cashweight = 1
wi ≥ 0 for long-only securities
cashweight ≥ minimumcash weight
wi ≤ maximumposition weight i
notionali ≤ liquiditycapacity i
orders must be valid under brokerage/API constraints
```
### 2. Two Separate Optimization Problems

The system must not confuse target selection with trade timing.

There are two related but separate optimizations.

The first is the holding optimization:

```
What should the account ideally own?
```
The second is the execution optimization:

```
Given what the account owns now, what should it trade right now?
```

The target portfolio can change before it is optimal to trade into it. A stock can be part of the optimal
target basket, but buying it immediately can still be wrong if the spread is too wide or the expected fill
quality is poor. Likewise, a stock can be removed from the target basket, but selling it immediately
can still be wrong if the exit cost is worse than the expected cost of waiting.

Therefore:

```
optimaltarget ≠ immediateorder
```
The target model determines destination. The execution model determines the economically correct
path toward that destination.

### 3. Candidate Universe

The system begins with a universe of candidate securities:

```
Ut = {symbol 1 , symbol 2 , ..., symbolN}
```
A candidate should be included only if it can plausibly improve expected after-cost returns and can
be traded through the available broker route.

At minimum, each candidate needs:

```
valid tradable instrument mapping
current or sufficiently fresh price
bid/ask when needed for execution
enough data to estimate expected return and cost
enough liquidity to make an order realistic
```
The universe should be broad enough to find the best available opportunity, but not so broad that
stale or low-quality candidates pollute ranking. Breadth has value only when the system can still
estimate edge and cost accurately.

For each candidate i, define a feature vector:


```
xi,t = [
technical features,
fundamental features,
event features,
semantic/context features,
liquidity features,
risk features,
execution features,
freshness features
]
```
The system should transform this feature vector into:

```
expected return
expected risk
expected cost
confidence
capacity
```
### 4. Input Signal Families

The signal model should combine multiple evidence families. No single feature family should be
assumed sufficient unless validated as such.

##### 4.1 Technical Momentum

Technical momentum attempts to measure whether market participants are already accumulating
the security.

Common inputs:


```
relative strength
trend slope
breakout strength
distance from moving averages
price acceleration
volume confirmation
intraday structure
support/resistance behavior
drawdown and rebound structure
realized volatility
```
The theoretical role of technical momentum is:

```
estimate near-term continuation probability and payoff size
```
However, technical momentum is not free alpha. It can be crowded, late, noisy, or too expensive to
trade after spread and slippage.

##### 4.2 Fundamental Quality

Fundamental quality attempts to measure whether the security has a durable reason to appreciate
over the selected horizon.

Common inputs:

```
earnings quality
revenue growth
profitability
balance sheet strength
valuation quality
analyst revision direction
institutional sponsorship
industry leadership
liquidity-adjusted quality
```
The theoretical role of fundamental quality is:

```
separate durable strength from purely noisy price motion
```
Fundamental quality is often more useful over multi-day or longer horizons than over very short
intraday horizons.


##### 4.3 Event and Catalyst Information

Event signals estimate whether new information has changed expected return.

Common inputs:

```
earnings surprises
guidance changes
news catalysts
sector catalysts
company-specific announcements
regulatory events
product launches
analyst upgrades or downgrades
unusual volume around an event
freshness of the catalyst
confirmation by price and volume
```
The theoretical role of event information is:

```
identify a reason the conditional expected return has changed
```
Events must be penalized for:

```
staleness
ambiguity
binary outcome risk
negative overhang
already-priced-in movement
wide spreads during news shocks
```
##### 4.4 Semantic and Contextual Information

Semantic context attempts to encode qualitative market interpretation in a structured way.

Common inputs:


```
whether the catalyst is company-specific or generic
whether sentiment is positive, negative, or mixed
whether the event confirms a broader theme
whether sector context supports the move
whether the reason for the move is fresh
whether there is unresolved negative overhang
```
The theoretical role of semantic context is:

```
improve signal quality by explaining why a move should continue
```
Semantic context should not be allowed to create false precision. Missing, generic, or stale context
should reduce confidence rather than inventing edge.

##### 4.5 Liquidity and Execution Quality

Liquidity is part of alpha only through after-cost realizability.

Common inputs:

```
bid
ask
spread
quote freshness
volume
relative volume
dollar volume
market depth proxy
historical slippage
participation rate
fill probability
order-size sensitivity
```
The theoretical role of liquidity is:

```
estimate whether paper expected return can be captured after trading costs
```
A high-alpha security can be a bad trade if the cost to enter and exit consumes the edge.

##### 4.6 Risk and Crowding

Risk and crowding estimate how much of the apparent edge is fragile.


Common inputs:

```
realized volatility
β
gap risk
weekend/news risk
crowding
short squeeze or unwind risk
correlation to existing holdings
drawdown sensitivity
market regime sensitivity
sector concentration
```
The theoretical role of risk is:

```
protect compounded returns from volatility drag and adverse path dependence
```
Risk should not be treated as "avoid all volatility." Volatility is acceptable when compensated by
enough expected return. The correct test is return per unit of after-cost risk.

### 5. Signal Normalization

Raw features arrive on incompatible scales:

```
percent returns
dollar volume
probabilities
text-derived scores
spreads
binary flags
time since event
```
The system should normalize each feature into a comparable numeric form.

For a positively oriented feature:

```
zi = normalize(rawi)
```
where higher is better.

For a negatively oriented feature:


```
zi = - normalize(rawi)
```
where higher raw value is worse.

For bounded score-style inputs:

```
si ∈ [ 0 , 100 ]
```
Interpretation:

```
0 = strongly unfavorable or unusable
50 = neutral
100 = strongly favorable
```
For probability-like scores:

```
pi = clamp(scorei / 100 , 0 , 1 )
```
For missing data, the system should not silently use optimistic defaults. Instead, it should calculate:

```
qualityi = data quality score
missingi = missing feature count or missing feature severity
```
and apply uncertainty penalties later.

### 6. Forecasting Expected Return

The first major output is expected gross return:

```
μi,H = 𝔼[ ri,t→t+H ∣ xi,t ]
```
where:

```
μi,H = expected return for security i over horizon H
ri,t→t+H = future return from time t to t+H
```
A general model can decompose expected return into:


```
μi,H =
ℙ(upi,H) · 𝔼[returni,H ∣ up]
+ ℙ(flati,H) · 𝔼[returni,H ∣ flat]
+ ℙ(downi,H) · 𝔼[returni,H ∣ down]
```
Since the flat term is often close to zero, a simplified form is:

```
μi,H =
ℙ(upi,H) · upsidei,H
```
- ℙ(downi,H) · downsidei,H

A still simpler long-only opportunity estimate is:

```
positiveedge i,H =
max(ℙ(upi,H) - 0. 5 , 0 ) · conditionalupside i,H
```
This only credits probability above neutral. A security with a 50 percent chance of being up does not
get positive directional edge merely because it has upside.

The system should estimate:

```
ℙ(upi,H)
conditionalupside i,H
conditionaldownside i,H
expectedpath volatility i,H
confidencei,H
```
Then:

```
gross_αi,H =
ℙ(upi,H) · conditionalupside i,H
```
- ( 1 - ℙ(upi,H)) · conditionaldownside i,H

If downside magnitude is unknown, a conservative proxy is:

```
gross_αi,H =
max(ℙ(upi,H) - 0. 5 , 0 ) · conditionalupside i,H
```
The more complete model is better when enough data exists.


### 7. Multi-Horizon Forecasting

Different signals are predictive over different horizons.

Examples:

```
live spread and order book data:
predictive over seconds to minutes
intraday structure:
predictive over minutes to hours
event momentum:
predictive over hours to days
fundamental quality:
predictive over days to months
sector rotation:
predictive over days to weeks
```
The system should estimate expected return across candidate horizons:

```
H ∈ {
minutes,
hours,
one day,
several days,
one week,
multiple weeks
}
```
For each horizon:

```
μi,H
σi,H
confidencei,H
costi,H
```
The preferred horizon for a trade is not necessarily the horizon with the largest gross return. It is the
horizon with the best after-cost compounded growth:


```
H*i =
arg maxH [
μi,H
```
- costi,H
- riskpenalty i,H
- uncertaintypenalty i,H
]

This is why a slower cadence can beat a faster cadence. Faster trading increases adaptability, but it
also increases cost. Faster trading is only better when the short-horizon forecast edge is strong
enough to overcome:

```
more spreads
more slippage
more missed fills
more partial fills
more churn
more order-state complexity
less reliable short-term prediction
```
### 8. Signal Confidence

Every expected return estimate needs a confidence estimate.

Define:

```
qi = confidence or data quality ∈ [ 0 , 1 ]
```
Confidence should increase with:

```
fresh data
multiple independent confirming signals
high liquidity
low missingness
stable signal definitions
validated historical predictive power
current quote availability
event confirmation
```
Confidence should decrease with:


```
stale data
missing bid/ask
thin liquidity
conflicting signals
unproven features
binary event risk
semantic ambiguity
abnormal volatility
newly listed security uncertainty
```
The confidence-adjusted expected return can be written:

```
μadj i =
qi · μi + ( 1 - qi) · μprior i
```
A conservative prior is:

```
μprior i = 0
```
This shrinks uncertain expected returns toward zero.

Equivalently, the model can subtract uncertainty cost:

```
uncertaintycost i =
uncertaintyscale · ( 1 - qi)
```
Then:

```
μafter uncertainty i =
μi - uncertaintycost i
```
The important principle is:

```
Uncertainty is a cost.
```
### 9. Expected Cost Model

A paper return is not a real return. The system must subtract all costs required to convert the paper
signal into account equity.

For a proposed trade a, total cost is:


```
TotalCost(a) =
EntryCost(a)
+ ExitCost(a)
+ SlippageCost(a)
+ SpreadCost(a)
+ MarketImpactCost(a)
+ PartialFillCost(a)
+ MissedFillCost(a)
+ OpportunityCost(a)
+ CarryCost(a)
+ UncertaintyCost(a)
+ OperationalCost(a)
```
All terms should be expressed in comparable units, usually basis points or dollars.

### 10. Spread Cost

For a buy, the spread cost is the premium paid above the fair midpoint.

For a sell, the spread cost is the discount accepted below the fair midpoint.

Let:

```
bidi = best bid
aski = best ask
midi = (bidi + aski) / 2
spreadi = aski - bidi
spreadpct i = spreadi / midi
spreadbps i = 10000 · spreadpct i
```
If a marketable buy crosses the spread:

```
buyspread cost bps ∼= 10000 · (aski - midi) / midi
= spreadbps i / 2
```
If a marketable sell crosses the spread:

```
sellspread cost bps ∼= 10000 · (midi - bidi) / midi
= spreadbps i / 2
```
If a limit order improves price but may not fill, the expected spread cost is:


```
expectedspread cost =
fillprobability · limitfill spread cost
+ ( 1 - fillprobability) · missedfill cost
```
Therefore, a limit order is better than a marketable order only when:

```
expectedspread savings > missedfill cost
```
### 11. Slippage Cost

Slippage is the difference between expected execution price and realized fill price.

For a buy:

```
slippagebps =
10000 · (fillprice - decisionreference price) / decisionreference price
```
For a sell:

```
slippagebps =
10000 · (decisionreference price - fillprice) / decisionreference price
```
Expected slippage should use recent realized fills when available:

```
𝔼[slippage ∣ symbol, session, side, liquidity] =
weighted average of comparable recent slippage observations
```
The model should use the most specific reliable sample:

```
same symbol + same side + same session
same symbol + same side
same liquidity bucket + same session
global session average
conservative default
```
If realized slippage worsens, the required edge should rise automatically.

### 12. Market Impact and Size Cost

Trade size changes cost.

Let:


```
N = trade notional
V = account value
ADV = average dollar volume or liquidity proxy
```
A simple account-relative size cost proxy is:

```
sizecost bps =
min(sizecost cap, sizecost slope · N / V)
```
A liquidity-relative proxy is:

```
impactcost bps =
impactscale · √(N / ADV)
```
A combined model can be:

```
marketimpact bps =
max(
accountrelative size cost bps,
liquidityrelative impact bps
)
```
The system should reduce order size when:

```
smaller order has positive expected value
larger order has negative expected value due to impact
```
This creates the principle of partial positive-EV execution:

```
If full target size fails the edge test, test whether a smaller slice clears.
```
### 13. Partial Fill Cost

Partial fills are not just incomplete success. They can leave the account in an unplanned intermediate
portfolio.

Let:

```
Qdesired = desired shares
Qfilled = expected filled shares
ρ = Qfilled / Qdesired
```

The expected value of an order with partial-fill risk is:

```
EVorder =
ℙ(fullfill) · EV(fullfill)
+ ℙ(partialfill) · EV(partialfill)
+ ℙ(nofill) · EV(nofill)
```
The partial-fill cost is:

```
partialfill cost =
EV(idealfull fill) - EVorder
```
Partial fill risk increases when:

```
spread is wide
liquidity is low
order is large
session is premarket or after-hours
limit price is passive
symbol is volatile
quote is stale
```
A trade should be placed only if:

```
EVorder after partial fill risk > EV(bestalternative)
```
### 14. Missed Fill Cost

A limit order can save spread but miss a profitable move.

Let:

```
Pfill = probability order fills
Emove if missed = expected adverse opportunity movement if the order does not fill
```
Then:

```
missedfill cost =
( 1 - Pfill) · Emove if missed
```
The expected benefit of a passive limit is:


```
limitEV =
Pfill · (α - limitexecution cost)
+ ( 1 - Pfill) · EVafter miss
```
The expected benefit of crossing immediately is:

```
crossEV =
α - marketableexecution cost
```
Use the limit only if:

```
limitEV > crossEV
```
This is the core tradeoff between price improvement and certainty of execution.

### 15. Entry and Exit Must Be Modeled Together

Buying is not a complete trade. A complete trade includes eventual exit.

The system should evaluate round-trip expected value:

```
RoundTripEV =
expectedholding return
```
- entrycost
- expectedexit cost
- carrycost

A buy is valid only if:

```
RoundTripEV > requirededge
```
Entry-only logic is insufficient because:

```
the exit spread can be wider than the entry spread
the account can be forced to hold overnight
liquidity can disappear after hours
Friday close creates weekend carry risk
the best exit window may not occur when expected
```
The system should estimate:


```
expectedexit session
expectedexit spread
expectedexit slippage
expectedexit liquidity
expectedexit time
forcedovernight probability
weekendcarry probability
```
Then:

```
expectedexit cost =
𝔼[spreadcost exit]
+ 𝔼[slippageexit]
+ 𝔼[marketimpact exit]
+ 𝔼[missedexit cost]
```
### 16. Carry Cost

Carry cost is the cost of being exposed while waiting.

Examples:

```
overnight gap risk
weekend news risk
holiday illiquidity
earnings event risk
macro event risk
portfolio drawdown risk
```
For a long equity holding:

```
carrycost =
overnightgap risk
+ weekendnews risk
+ eventgap risk
+ volatilitydrag
+ capitallockup cost
```
If the position must cross a weekend:


```
carrycost weekend =
weekendrisk scale · exposure · vulnerability
```
where vulnerability can include:

```
low risk-off resilience
high β
high volatility
weak liquidity
negative overhang
binary event uncertainty
large concentration
```
The system should be willing to hold through a weekend when expected return is large enough. It
should not hold through a weekend merely because the position already exists.

### 17. Opportunity Cost

Opportunity cost is central to optimal trading.

Every action competes against alternatives:

```
buy candidate A
buy candidate B
hold current position
sell to cash
wait for a better quote
wait for a better signal
repair an order
do nothing
```
The opportunity cost of choosing action A is:

```
OpportunityCost(A) =
maxB EVafter cost(B) - EVafter cost(A)
```
where B ranges over feasible alternatives.

For a cash decision:


```
Buy if:
EVafter cost(buy) > EVafter cost(waitin cash) + hurdle
```
For a rotation:

```
Rotate old → new if:
EVafter cost(new holding)
```
- EVafter cost(old holding)
> sellcost old + buycost new + transitionuncertainty + hurdle

For an exit to cash:

```
Sell to cash if:
EVafter cost(cash or waiting)
```
- EVafter cost(hold current position)
> sellcost + reboundrisk + hurdle

Opportunity cost is why a tiny positive signal is not enough. A trivial edge can be worse than waiting
for a better opportunity.

### 18. Required Edge Hurdle

The system should not trade on infinitesimal theoretical edge.

Define:

```
hurdle =
modelerror buffer
+ quotestaleness buffer
+ opportunitycost buffer
+ operationalrisk buffer
```
A trade is valid only if:

```
EVafter cost(action) - EVafter cost(bestalternative) > hurdle
```
The hurdle should be dynamic. It should rise when:


```
spreads are wider
quotes are stale
liquidity is lower
volatility is higher
model confidence is lower
recent slippage is worse
the trade is larger
the session is extended hours
the holding crosses close/weekend
```
It can fall when:

```
quotes are fresh
liquidity is excellent
confidence is high
recent fills are good
drift is large
the target opportunity is unusually strong
the current holding has high negative expected value
```
The important rule:

```
No trade should be placed merely because gross α is positive.
```
The correct condition is:

```
after-cost advantage over alternatives has enough surplus.
```
### 19. Portfolio Construction

After estimating candidate expected returns and costs, the system constructs a target portfolio.

Let:


```
μ = vector of expected after-cost returns
Σrisk = covariance matrix for joint downside, volatility drag, drawdown,
liquidity stress, and crowded exposure
Σconfirm = covariance matrix for positively confirmed common movement,
such as sector/theme leadership and breadth-supported momentum
w = portfolio weights
c(wcurrent, w) = transition cost from current portfolio to target portfolio
u(w) = uncertainty penalty
l(w) = liquidity/capacity penalty
k(w) = concentration/crowding penalty
g(w) = carry and gap-risk penalty
γrisk(t) = nonnegative dynamic risk-covariance penalty
λconfirm(t) = nonnegative dynamic covariance-confirmation reward
```
The objective is:

```
maximize over w:
F(w) =
w′ · μ
```
- 0. 5 · γrisk(t) · w′ · Σrisk(t) · w
+ λconfirm(t) · w′ · Σconfirm(t) · w
- c(wcurrent, w)
- u(w)
- l(w)
- k(w)
- g(w)

subject to:

```
∑i wi + cashweight = 1
0 ≤ wi ≤ maxweight i
cashweight ≥ cashmin
liquiditycapacity i ≥ plannednotional i
securityi is tradable
```
γrisk(t) controls how strongly the strategy penalizes joint downside, volatility drag, drawdown,
liquidity stress, and crowded exposure. It is nonnegative. A negative risk-aversion coefficient is the
wrong abstraction because it would reward crash-like covariance spikes when those spikes represent
common downside.


The useful "negative covariance penalty" intuition is represented by λconfirm(t), not by making γrisk(t)
negative. Positive covariance can be evidence of a winning cluster when correlated securities are
moving up together with confirming breadth, trend, liquidity, and event context. In that case,
Σconfirm(t) and λconfirm(t) let the optimizer intentionally own a correlated winner cluster. In a stress
regime, λconfirm(t) should fall toward zero while γrisk(t) rises.

At the highest level, covariance should therefore be native to target construction as two conditional
objects:

```
bad covariance:
joint loss, drawdown, volatility drag, liquidity stress, crowding
good covariance:
correlated positive continuation, sector/theme leadership, broad confirmation
```
The optimizer should learn when each object matters from out-of-sample after-cost portfolio utility,
not from a fixed signed scalar.

### 20. Position Sizing

The correct position size is not simply "buy the best stock."

For a single security with expected return μ, variance σ^2 , and no constraints, a Kelly-style
approximation is:

```
wkelly = μ / σ^2
```
In real trading, this must be modified:

```
wopt =
shrink(
μafter cost / σ^2 ,
confidence,
liquidity,
concentration,
drawdown tolerance,
maximum position cap
)
```
A practical sizing equation is:


```
rawweight i =
positivenet edge ip
* confidencemultiplier i
* liquiditymultiplier i
* diversificationmultiplier i
```
where:

```
p > 1
```
creates top-heavy allocation toward the strongest opportunities.

Then:

```
wi =
min(maxposition i, rawweight i / sum(rawweight j) · investableweight)
```
If caps leave unused capital:

```
cashweight = 1 - ∑i wi
```
Cash is not a failure if no remaining candidate clears the hurdle.

### 21. Concentration

Concentration is not automatically bad. Concentration is correct when the best opportunities are
much better than the alternatives and the extra expected return compensates for extra risk.

The concentration penalty should represent:

```
single-name gap risk
correlated holdings
liquidity risk
crowded-exit risk
model uncertainty
drawdown drag
```
A simple concentration cost is:

```
concentrationcost =
concentrationscale · ∑i max(wi - comfortableweight i, 0 )^2
```

Another proxy is:

```
crowdingcost i =
crowdingscale · ( 1 - crowdingcontrol i)
```
The system should not deconcentrate merely to look diversified. It should deconcentrate when
diversification increases expected geometric after-cost return.

### 22. Cash

Cash has option value.

Cash allows the system to:

```
wait for a better entry
avoid a bad spread
avoid uncertain signals
deploy into a stronger opportunity later
avoid forced liquidation
preserve cash for repairs
```
The expected value of cash is:

```
EVcash =
riskfree return
+ optionvalue of waiting
+ avoidedbad trade cost
```
A buy should happen only when:

```
EVbuy after cost > EVcash + hurdle
```
An all-cash or partial-cash state is correct when:

```
maxi EVbuy after cost i ≤ EVcash + hurdle
```
Cash should not be used as an emotional safety position. It should be used when it mathematically
beats available trades.

### 23. Target Drift

Target drift measures how far current holdings are from optimal holdings.


For each security:

```
currentweight i = currentvalue i / accountvalue
targetweight i = targetvalue i / accountvalue
drifti = targetweight i - currentweight i
```
Gross drift is:

```
grossdrift =
∑i abs(drifti)
```
A two-sided normalized drift is:

```
portfoliodrift =
grossdrift / 2
```
The division by two avoids double-counting a rotation. Moving 20 percent from one stock to another
creates 20 percent sell drift and 20 percent buy drift, but the portfolio is 20 percent away from the
target, not 40 percent.

Drift creates urgency only when the value of correcting drift exceeds the cost of correcting it.

```
Rebalance if:
EV(correcting drift now) > EV(waiting) + hurdle
```
### 24. Trade Timing

Trade timing decides when target drift should become a real order.

At time t, for each candidate trade a:

```
TradeNowValue(a, t) =
expected_αcapture(a, t)
```
- executioncost(a, t)
- futureexit cost(a, t)
- carrycost(a, t)
- uncertaintycost(a, t)
- missedbetter timing cost(a, t)

Waiting has value:


```
WaitValue(a, t) =
expected_αcapture if later
```
- expectedexecution cost if later
+ optionvalue of new information

Trade now only if:

```
TradeNowValue(a, t) > WaitValue(a, t) + hurdle
```
This is the theoretical justification for fluid trading. The system should not rebalance at a fixed time
just because the clock says so. It should trade when the expected value of acting now exceeds the
expected value of waiting.

However, fluid trading does not mean constant trading. A well-calibrated fluid system can evaluate
continuously and still trade rarely if most opportunities do not clear costs.

### 25. Session-Aware Trading

The same security has different execution economics in different sessions.

Session states include:

```
premarket
regular market
after hours
overnight
weekend
holiday
early close
```
For each session s, estimate:

```
spreads
liquiditys
fillprobability s
slippages
volatilitys
gaprisk s
quotereliability s
```
Then:


```
executioncost s =
spreadcost s
+ slippages
+ marketimpact s
+ partialfill cost s
+ missedfill cost s
```
A trade can be valid in one session and invalid in another.

For example:

```
regular market:
tighter spreads and better liquidity
premarket:
early information advantage but wider spreads and lower liquidity
after hours:
event reaction opportunity but higher spread and partial-fill risk
Friday close:
lower ability to exit soon and higher weekend carry risk
```
Extended-hours access should be allowed when it creates positive after-cost return, but extended-
hours trades need stricter cost and confidence checks.

### 26. Limit Order Theory

A limit order chooses price improvement over guaranteed immediate execution.

Let:

```
Pfill(L) = probability a limit order at price L fills
Cfill(L) = execution cost if it fills
Cmiss(L) = cost if it does not fill
Α = expected α of owning the position
```
Then:

```
EVlimit(L) =
Pfill(L) · (Α - Cfill(L))
+ ( 1 - Pfill(L)) · (-Cmiss(L))
```

The optimal limit price is:

```
L* = arg maxL EVlimit(L)
```
A more aggressive limit increases fill probability but worsens price. A more passive limit improves
price but increases missed-fill risk.

The system should gradually increase aggression when:

```
urgency rises
session deadline approaches
α decay risk rises
existing order has not filled
the opportunity is strong enough to justify worse price
```
It should remain passive or defer when:

```
spread is too wide
fill probability is poor
α is weak
waiting has higher option value
```
### 27. Market Order Theory

A market order chooses certainty of immediate execution over price control.

The expected value of a marketable order is:

```
EVmarket =
Α - spreadcost - slippagecost - impactcost
```
Market orders are appropriate only when:

```
EVmarket > max(EVlimit, EVwait, EVhold, EVcash) + hurdle
```
This means urgency alone is not enough. The alpha being captured must be worth the cost of crossing
the spread and accepting slippage.

### 28. Buy Decision

For a buy candidate i of notional size N:


```
BuyEVi(N) =
expectedreturn i(N)
```
- entrycost i(N)
- expectedexit cost i(N)
- carrycost i(N)
- uncertaintycost i
- opportunitycost of cash i

The buy is allowed only if:

```
BuyEVi(N) > max(
EVhold cash,
EVwait for better entry,
EVbuy other candidate,
EVrepair order state
) + hurdle
```
If BuyEVi(N) is negative for the full desired size, test smaller sizes:

```
N*i =
arg maxN BuyEVi(N)
```
subject to:

```
minimumorder size ≤ N ≤ targetnotional i
```
Place the buy only if:

```
BuyEVi(N*i) > hurdle
```
### 29. Sell Decision

For a sell candidate i:


```
SellEVi(N) =
avoidedfuture loss i(N)
+ opportunityvalue of freed capital i(N)
```
- sellexecution cost i(N)
- reboundrisk i(N)
- taxor operational cost i(N)

Since tax is not a major factor for this system, the relevant terms are mostly:

```
avoided loss
freed capital
execution cost
rebound risk
operational/order-state cost
```
Sell if:

```
SellEVi(N) > max(
EVhold current position,
EVwait for better exit,
EVpartial sell,
EVrotate later
) + hurdle
```
A position absent from the target basket is not automatically an immediate sell. The system should
sell only when the exit decision has positive expected value.

### 30. Rotation Decision

A rotation sells one holding and buys another.

For current holding a and candidate replacement b:

```
RotationEV(a → b) =
EVhold b
```
- EVhold a
- sellcost a
- buycost b
- transitionrisk
- partialfill pairing risk


Rotate only if:

```
RotationEV(a → b) > hurdle
```
Partial-fill pairing risk is important. Selling a but failing to buy b can leave the account
unintentionally in cash. Buying b but failing to sell a can create unintended concentration. Therefore,
rotation should consider the joint probability of both legs completing.

### 31. Hold Decision

Holding is an active choice, not the absence of a choice.

For a current position i:

```
HoldEVi =
expectedfuture return i
```
- carrycost i
- riskcost i
- opportunitycost of capital i

Continue holding if:

```
HoldEVi > max(
SellEVi,
RotationEVi to best replacement,
CashEV
) + hurdle
```
This prevents the system from churning just because targets changed slightly.

### 32. Rebalance Decision

A rebalance is a set of trades, not a single trade.

Let:

```
T = {trade 1 , trade 2 , ..., tradeK}
```
The value of the package is:


```
PackageEV(T) =
EV(resultingportfolio after T)
```
- EV(currentportfolio)
- totalexecution cost(T)
- packagepartial fill cost(T)
- packageoperational cost(T)

Execute the package only if:

```
PackageEV(T) > hurdlepackage
```
A package can be rejected even when one trade looks good in isolation if the combined package
creates too much concentration, cash shortfall, fill mismatch, or turnover cost.

### 33. Account Constraints

The optimization is constrained by account state:

```
cash
cash available to trade
existing positions
pending orders
minimum order size
whole-share rounding
order session
cash floor
order rate limits
brokerage/API payload rules
```
A mathematically attractive trade that cannot be validly placed is not a feasible action.

The feasible action set is:

```
Ft = {At : At satisfies account, broker, and market constraints}
```
The actual decision is:

```
A*t = arg maxA in F t EVafter cost(A ∣ St)
```

### 34. Open Orders

Open orders change the state.

An existing order can represent:

```
already intended exposure
partial fill risk
blocked cash
stale intent
wrong session
wrong price
duplicate exposure risk
```
For each open order, decide:

```
keep
modify
cancel
cancel and replace
wait for terminal status
```
The order-state decision is:

```
OrderAction* =
argmax over order actions [
EVafter cost(resultingorder state)
]
```
Do not place a new order if an existing order already expresses the same desired trade at an
acceptable price. Do not leave a stale order working if the current optimal portfolio no longer wants it
and canceling is feasible.

### 35. Repair Actions

Some actions are not alpha-seeking trades. They repair operational state.

Examples:


```
cash deficit repair
buying-power repair
stale order cancellation
duplicate order cleanup
position/order mismatch repair
failed cancel/replace recovery
```
Repair actions should still be evaluated economically, but their alternative is often worse than
ordinary waiting because unresolved operational state can block future profitable trades.

RepairEV can be written:

```
RepairEV =
valueof restored trading capacity
+ avoidedoperational loss
```
- repairexecution cost

Repair if:

```
RepairEV > EVwaiting with broken state + hurdle
```
### 36. Freshness

Stale data is not neutral. Stale data creates uncertainty.

For each input:

```
age = currenttime - observationtime
```
Define a decay:

```
freshnessweight = exp(-age / halflife)
```
Then:

```
effectivesignal =
freshnessweight · rawsignal
+ ( 1 - freshnessweight) · priorsignal
```
For many trading signals:


```
priorsignal = neutral
```
If the signal is too stale, the system should either:

```
refresh it before trading
or penalize confidence enough that the trade fails the hurdle
```
### 37. Learning

The model should improve by comparing predictions to realized after-cost outcomes.

For every decision, store:

```
state at decision time
candidate action
chosen action
rejected alternatives
predicted α
predicted cost
predicted fill probability
actual fill
actual slippage
actual subsequent return
actual opportunity cost
```
The learning target should be after-cost utility:

```
label =
realizedreturn
```
- realizedentry cost
- realizedexit cost
- realizedslippage
- realizedopportunity cost

Features should be judged by whether they improve prediction of this label out of sample.

The correct evaluation is not:

```
Did this feature sound reasonable?
```
The correct evaluation is:


```
Did this feature improve future after-cost portfolio growth in comparable
walk-forward testing?
```
### 38. Bayesian View

The optimization can be interpreted as a Bayesian statistical problem.

The system has uncertain beliefs about each security's future return:

```
μi ∼ posterior distribution
```
Given data Dt:

```
ℙ(μi ∣ Dt) proportional to ℙ(Dt ∣ μi) · ℙ(μi)
```
The expected return estimate is:

```
𝔼[μi ∣ Dt]
```
The uncertainty penalty should increase with posterior variance:

```
uncertaintycost i =
λuncertainty · Var(μi ∣ Dt)
```
Then:

```
riskadjusted_αi =
𝔼[μi ∣ Dt] - λuncertainty · Var(μi ∣ Dt)
```
This is useful because two securities can have the same expected return but very different confidence.
The less certain estimate should require a larger edge.

A Bayesian model is especially useful for:

```
combining correlated signals
shrinking noisy features
handling missing data
estimating uncertainty
ranking research value of new features
avoiding overfitting static weights
```

However, Bayesian scoring alone is not enough. The posterior alpha must still be tested through the
full after-cost portfolio and execution model.

### 39. Feature Weighting Theory

The ideal signal is not a simple static sum of hand-picked features unless that sum has been
validated.

The general model is:

```
μi = f(xi)
```
where f can include:

```
linear effects
nonlinear effects
interactions
regime dependence
feature uncertainty
correlation among inputs
```
A linear approximation is:

```
μi =
β 0 + β 1 *x 1 + β 2 *x 2 + ... + βn*x n
```
But if features are correlated, naive weights can double-count information.

For example:

```
trend
relative strength
breakout
recent return
```
may all measure related momentum. Adding them with independent high weights can overstate
edge.

The better approach is to learn:


```
which variables predict after-cost return
which variables are redundant
which variables matter only in specific regimes
which variables matter only through execution cost
which variables should be penalties rather than α
```
The target is:

```
learn f(x) that best predicts realized after-cost utility
```
not:

```
make the most impressive-looking score.
```
### 40. Regime Dependence

The optimal strategy changes by regime.

Regimes can include:

```
risk-on market
risk-off market
high volatility
low volatility
strong breadth
weak breadth
earnings-heavy calendar
holiday/low-liquidity period
rate-sensitive market
sector rotation market
```
A feature can be valuable in one regime and noise in another.

Therefore:

```
μi = f(xi, regimet)
costi = c(xi, regimet, sessiont)
```
The same ticker can be:


```
buy in one regime
hold in another
sell in another
wait in another
```
### 41. Evaluation Metric

The model should be evaluated by future expected after-cost compounded return.

Useful metrics:

```
CAGR
total return
max drawdown
volatility
Sharpe-like ratio
turnover
cost drag
slippage
partial-fill frequency
missed-fill cost
liquidity-limited dollars
capacity
percentage of trades with positive realized after-cost edge
cash dwell reason quality
```
CAGR is important because the objective is return maximization, but CAGR alone can be misleading
if:

```
costs are under-modeled
partial fills are ignored
liquidity capacity is unrealistic
sample is too short
strategy overfits a period
drawdown creates practical ruin risk
```
The preferred evaluation objective is:


```
maximize expected future after-cost CAGR subject to realistic execution and
survivability constraints.
```
### 42. Comparable Testing

Strategies should be compared under the same assumptions:

```
same date window
same universe rules
same signal freshness assumptions
same transaction cost model
same spread/slippage model
same partial-fill model
same liquidity capacity model
same order timing assumptions
same account constraints
same promotion criteria
```
Otherwise, a strategy can appear better only because it was graded under easier assumptions.

The correct comparison is:

```
Strategy A after-cost portfolio replay
versus
Strategy B after-cost portfolio replay
under the same execution model.
```
### 43. Complete Holding Algorithm

This is the implementation-independent target-holding algorithm.


Input:
candidate universe U
current account state S
current holdings wcurrent
forecast horizons H
market/account constraints K

For each candidate i in U:
1. Validate tradability.
2. Collect feature vector xi.
3. Normalize features.
4. Estimate signal freshness.
5. Estimate confidence qi.
6. Estimate expected return μi,H for each horizon H.
7. Estimate expected risk σi,H.
8. Estimate liquidity/capacity.
9. Estimate entry cost.
10. Estimate future exit cost.
11. Estimate carry risk.
12. Estimate uncertainty penalty.
13. Convert gross α to after-cost α.

For each horizon H:
14. Build candidate after-cost return vector μafter cost,H.
15. Build conditional covariance estimates:
Σrisk,H for joint downside and volatility drag.
Σconfirm,H for positively confirmed common movement.
16. Solve constrained portfolio optimization:
maximize:
w′ · μafter cost,H

- 0. 5 · γrisk(t,H) · w′ · Σrisk,H · w
+ λconfirm(t,H) · w′ · Σconfirm,H · w
- transitioncost(wcurrent → w)
- concentrationpenalty(w)
- liquiditypenalty(w)
- carrypenalty(w)
subject to:
sum(w) + cash = 1
0 ≤ wi ≤ maxweight i


```
cash ≥ cashmin
order/tradability/liquidity constraints hold
17. Score the resulting portfolio by expected after-cost geometric growth.
Select:
18. Choose the horizon and target portfolio with maximum expected after-cost
geometric growth.
Output:
target weights w*
cash weight
expected after-cost return
risk estimate
cost estimate
confidence estimate
explanation for each included and excluded candidate
```
### 44. Complete Trading Algorithm

This is the implementation-independent trade-placement algorithm.


Input:
target portfolio w*
current portfolio wcurrent
cash available to trade
open orders
live quotes
current session
recent execution history
account/broker constraints

Step 1 :
Compute target drift.

Step 2 :
Generate feasible candidate actions:
hold
buy
sell
partial buy
partial sell
rotate
cancel order
modify order
wait
repair

Step 3 :
For each action A:
estimate expected α captured
estimate entry cost
estimate exit cost
estimate spread cost
estimate slippage
estimate market impact
estimate partial-fill cost
estimate missed-fill cost
estimate carry cost
estimate opportunity cost
estimate operational cost
estimate uncertainty cost


Step 4 :
Compute:
EVafter cost(A) =
expected_α(A)

- allcosts(A)

Step 5 :
Compute best alternative:
BestAlternativeEV =
max EVafter cost(B)
for every feasible alternative B

Step 6 :
Compute surplus:
surplus(A) =
EVafter cost(A) - BestAlternativeEV

Step 7 :
Trade only if:
surplus(A) > dynamichurdle(A)

Step 8 :
If full-size action fails:
search smaller sizes.

Step 9 :
If a passive limit order beats crossing:
place or modify limit order.

Step 10 :
If crossing beats passive/waiting:
place marketable order if the session and broker constraints allow it.

Step 11 :
If no action clears:
hold, wait, or keep cash.

Output:
chosen action set
deferred action set
reason each action was chosen or rejected
expected after-cost value of each action


### 45. The Central Equation

The entire strategy can be compressed into one equation:

```
Choose the portfolio and orders that maximize:
Expected Future Wealth
```
- Entry Costs
- Exit Costs
- Spread
- Slippage
- Market Impact
- Partial-Fill Risk
- Missed-Fill Risk
- Liquidity/Capacity Cost
- Uncertainty Cost
- Concentration/Crowding Cost
- Overnight/Weekend/Event Carry Risk
- Opportunity Cost
- Operational/Broker Constraint Cost
among all feasible alternatives.

In mathematical shorthand:

```
(w*, A*) =
arg maxw, A in feasible set
𝔼[log(Wt+H) ∣ St, w, A]
```
- Ctotal(w, A ∣ St)

where:


```
Ctotal =
Centry
+ Cexit
+ Cspread
+ Cslippage
+ Cimpact
+ Cpartial fill
+ Cmissed fill
+ Cliquidity
+ Cuncertainty
+ Cconcentration
+ Ccarry
+ Copportunity
+ Coperational
```
### 46. Practical Interpretation

In plain English:

```
Own the securities with the highest believable future return after subtracting
the cost and risk of actually owning them.
Trade only when the expected benefit of trading now beats holding, cash,
waiting, and every other feasible action after all costs.
```
This means:

```
a high score is not enough
a positive signal is not enough
a target mismatch is not enough
cash is not automatically bad
waiting is sometimes optimal
partial sizing is sometimes optimal
selling is sometimes optimal
holding a non-target can temporarily be optimal
aggressive trading is optimal only when after-cost edge is large enough
```
The strategy is aggressive when the math supports aggression and patient when patience has higher
expected value.


### 47. What Must Never Happen

The system should never:

```
trade because a target changed without checking execution EV
buy because gross α is positive but after-cost α is negative
sell because a holding is visually stale without checking exit EV
rotate without checking both sell cost and replacement buy surplus
ignore partial-fill or missed-fill risk
ignore weekend/overnight carry risk
ignore stale data
double-count correlated signals
promote a strategy from incomparable tests
confuse historical paper CAGR with realistic after-cost CAGR
hide cash dwell without explaining the opportunity-cost reason
allow non-economic safety gates to block positive-EV trades
allow non-economic aggression to force negative-EV trades
```
### 48. What Future Improvements Should Target

Future improvements should make one of these estimates better:


```
expected return
conditional upside
conditional downside
probability of being up
probability of being best available opportunity
signal confidence
feature redundancy
regime dependence
entry spread
exit spread
slippage
market impact
fill probability
partial-fill cost
missed-fill cost
opportunity cost
carry risk
portfolio covariance
drawdown/geometric growth penalty
```
If a change does not improve one of those estimates or improve the ability to act on them, it probably
does not improve returns.

### 49. Final Summary

The optimal trading method is:

```
1. Convert all available evidence into expected future return, risk, cost, and
confidence.
2. Choose the target holdings that maximize expected after-cost geometric
portfolio growth under real account and broker constraints.
3. Continuously compare trading now against holding, cash, waiting, rotating,
resizing, and order repair.
4. Place trades only when the selected action has the highest modeled expected
after-cost value by more than a dynamic hurdle.
5. Learn from realized after-cost outcomes, not from raw paper returns or
appealing narratives.
```

That is the strategy's mathematical contract.

### 50. Applied Model: From Hypothetical Optimum To Practical

### Implementation

The preceding sections describe the ideal trading system as a mathematical object: an adaptive
Bayesian decision process that chooses among buy, sell, hold, wait, repair, and cash actions by
maximizing expected after-cost utility. That ideal model is intentionally broad. It says what should be
optimized, but it does not by itself say how a practical implementation with finite history, stale
market data, asynchronous brokerage state, order queues, partial fills, and computational limits
should approximate the optimum minute by minute.

This applied paper begins with the original theory almost exactly as specified above, then instantiates
it as a practical model. The practical implementation is not a single magic equation. It is a layered
approximation in which each layer owns a different decision boundary:

```
market and account observations
→ feature construction and freshness checks
→ Bayesian and shrinkage research layer
→ source package selector
→ portfolio target gateway
→ provenance membership action signal
→ dynamic friction trading gate
→ brokerage order and reconciliation layer
→ prospective shadow evaluation monitor
```
The important applied design choice is that stock selection, target generation, and order execution
are not allowed to blur into one another. The stock selection layer asks: "Which names deserve
capital under the current evidence?" The target gateway asks: "What weights should those names
receive, subject to cash, tradability, and account constraints?" The execution gateway asks: "Given
the current holdings and brokerage state, is this specific order worth placing after costs, delays,
spreads, and the value of waiting?" The shadow evaluation monitor asks: "Has a challenger policy
produced enough clean, causal evidence to replace the validated policy?"

That separation is what makes the applied model practical. A powerful predictive model is useful
only if the action that follows from it is still profitable after friction. Conversely, a conservative
execution gate is useful only if it protects a target policy that actually has positive expected value. The
practical implementation therefore treats every proposed trade as a posterior claim about a future
state of the account, not as a raw ranking signal.

In compact notation, the applied system tries to approximate:


```
a*t =
arg maxa in A t
𝔼[
U(Wt+h, qt+h, ct+h, st+h)
```
- U(Wt, qt, ct, st)
| It, a
]

where:

```
a*t is the best available action at time t.
At is the feasible action set: buy, sell, hold, wait, repair, or leave cash
idle.
Wt is account wealth.
qt is the portfolio vector.
ct is cash.
st is brokerage/order state.
It is the information set, including prices, features, source package
outputs, account state, and freshness metadata.
h is the practical signal horizon used by the execution layer.
```
The ideal version would jointly integrate over every future price path, fill path, brokerage-state path,
and model-parameter path. The implemented version factorizes the problem into lower-dimensional
approximations that can run repeatedly during the trading session.

### 51. Literature Lineage: The 2021 Bayesian MIDAS Paper

The most important external research inspiration for the current Bayesian layer is the 2021
econometrics paper:

```
Mogliani, Matteo and Simoni, Anna.
"Bayesian MIDAS penalized regressions: Estimation, selection, and prediction."
Journal of Econometrics, 222 ( 1 ), 833 - 860 , 2021.
```
The public bibliographic record is available through [IDEAS/RePEc]
(https://ideas.repec.org/a/eee/econom/v222y2021i1p833-860.html), and an open preprint is
available at [arXiv:1903.08025](https://arxiv.org/abs/1903.08025).

That paper is about high-dimensional mixed-frequency regression. Its empirical setting is
macroeconomic nowcasting, especially GDP growth forecasting. Its method combines several ideas
that are unusually relevant to a practical trading implementation:


```
many predictors;
predictors arriving at different frequencies;
strongly correlated lag structures;
small effective samples relative to the number of candidate regressors;
grouped selection, so that an economically meaningful predictor and its lags
can be selected or suppressed together;
Bayesian shrinkage, so weak evidence is pulled toward a conservative prior;
spike-and-slab style inclusion logic, so the model can distinguish "probably
irrelevant" predictors from "useful but uncertain" predictors;
posterior predictive density, so the output is not merely a point forecast
but a distribution over future outcomes.
```
The applied trading implementation does not copy Mogliani and Simoni's model literally. It does not
run their exact GDP-nowcasting MIDAS design online. It does not place each equity signal into the
same macroeconomic lag polynomial structure. It also does not currently use a full online MCMC
sampler in the execution path. The credit due to that paper is conceptual and architectural: it shows
how to build a disciplined Bayesian forecasting system when the input space is large, asynchronous,
grouped, noisy, and highly collinear.

In trading terms, the paper motivates the following principle:

```
Do not treat every raw feature as an independent vote.
Treat each economically related feature family as a structured object,
learn how much that object deserves to matter,
and shrink uncertain objects toward a conservative prior.
```
For example, a momentum feature, its centered form, its lagged form, and its interaction with
volatility should not be interpreted as four fully independent discoveries. They are a group. If the
group has weak out-of-sample evidence, it should be suppressed as a group. If the group has evidence
but the sample is small, it should contribute, but with a posterior uncertainty penalty. If the group is
useful in one regime and harmful in another, the system should learn a regime-conditioned weight
rather than assuming global truth.

The abstract form of the Mogliani-Simoni idea can be written as:

```
yt = α + ∑g= 1 G Xt,g βg + εt
βg ∣ γg, τg
∼ γg · 𝒩( 0 , τg^2 Ig)
+ ( 1 - γg) · spikenear zero
γg ∼ Bernoulli(πg)
```

where:

```
g indexes feature groups;
Xt,g is the design block for group g;
βg is the coefficient vector for that group;
γg is the group inclusion indicator;
τg is the group-specific shrinkage scale;
πg is the prior probability that the group belongs in the model.
```
The trading adaptation changes the target and the operational cadence:

```
futureafter cost_edgei,t,h
= αt
+ ∑g Xi,t,g βg,r(t)
+ sourcepackage_effectp(t)
+ accountstate_effecta(t)
+ executionstate_effecte(t)
+ εi,t,h
```
Here:

```
i is the ticker or candidate position;
t is the decision time;
h is the action horizon;
r(t) is the latent or observed regime;
p(t) is the active source package;
a(t) is the account state;
e(t) is the execution state.
```
The practical implementation inherits the Bayesian lesson: estimate a distribution, not a mere score;
shrink uncertain evidence; respect grouped predictors; and evaluate usefulness by forward after-cost
value rather than by in-sample fit.

The translation from the 2021 paper to this applied model is therefore a change of domain, target,
and cadence, not a rejection of the original structure. In the macroeconomic paper, the raw
observations are macro series such as monthly and quarterly indicators, the grouped objects are lag-
polynomial predictor blocks, and the target is a macroeconomic forecast. In the applied trading
model, the raw observations are real-time and slow-moving market inputs: technical analysis,
fundamental analysis, quote quality, event context, source membership, portfolio state, and session
state. The grouped objects are not GDP lag blocks; they are trading evidence families. The target is
not GDP growth. It is short-horizon future after-cost edge.


This is what makes the adaptation nontrivial. The 2021 paper is a macroeconomic nowcasting model.
The applied model takes the same Bayesian discipline and uses it as a real-time TA/FA/action-value
system:

```
macroeconomic nowcasting:
mixed-frequency economic indicators
→ grouped lag predictors
→ posterior predictive macro forecast
real-time applied trading:
TA, FA, liquidity, event, source, portfolio, and session evidence
→ grouped trading predictors
→ posterior predictive after-cost action edge
```
The mathematical inheritance is grouped Bayesian shrinkage. The operational change is that the
posterior forecast is immediately passed to an execution gateway that charges spread, slippage, stale-
quote risk, queue risk, cash-only feasibility, and the value of waiting.

### 52. The Applied State Space

The practical algorithm can be described as a partially observed Markov decision process, but with
important implementation approximations.

Let the hidden state be:

```
St =
(
μt,
Σt,
Rt,
Lt,
Et,
Bt,
Ot
)
```
where:

```
μt is the vector of true forward expected returns.
Σt is the covariance and co-movement structure.
Rt is the latent regime.
Lt is liquidity and spread state.
```

```
Et is event and calendar state.
Bt is broker/account state.
Ot is open-order state.
```
The system does not observe St directly. It observes:

```
Yt =
(
pricest,
barst,
factorst,
sourceoutputs t,
accountpositions t,
casht,
openorders t,
fillst,
freshnesst
)
```
The Bayesian ideal would maintain:

```
p(St, θ ∣ Y 1 :t)
```
where θ contains model parameters. In a practical implementation, the state posterior is
approximated by cached summaries:

```
feature values and z-scores;
source package predictions;
provenance tags identifying why each ticker entered the target set;
recent realized forward outcomes;
posterior-style factor summaries;
dynamic friction estimates;
order queue state;
prospective shadow promotion statistics.
```
The decision process is:


```
belieft = updatebelief(belieft- 1 , Yt)
targetst = targetgateway(belieft, accountt)
actionst = executiongateway(targetst, accountt, orderstate t)
orderst = brokerrouter(actionst)
belieft+ 1 = observeand update(orderst, fillst, markett)
```
A lay interpretation is simple: the practical implementation keeps a running belief about which
stocks deserve capital, turns that belief into a target portfolio, and then places only the trades whose
expected benefit is still large enough after real trading friction.

### 53. Current Applied Model

The current practical implementation is a validated baseline source-selector trading surface with a
prospective shadow promotion monitor attached. Conceptually, it keeps trading behavior on the
strongest validated surface while collecting causal evidence for a more adaptive surface selector in
the background. The design is intentionally conservative relative to the research frontier: a
challenger can be studied continuously, but it cannot replace the baseline surface merely because a
short historical window looks attractive.

As a rule for the whole applied paper, numerical constants should not be read as magic numbers.
Each number should have one of four roles:

1. A promoted replay calibration, meaning it was chosen because full-window
    causal replay and deployability checks favored it over tested alternatives.
2. A real brokerage/account constraint, meaning it comes from what a
consumer-level brokerage account, order router, or account type can safely do.
3. A unit conversion, meaning the number only translates one time or risk unit
into another.
4. A governance value, meaning the number controls what may be enforced
versus what must remain observational until enough causal evidence exists.

When the applied model lists a static value, the proper interpretation is therefore: "What did this
value approximate, what alternatives were tested or ruled out, and what failure would happen if it
were moved carelessly?" A value can be simple in a practical implementation while still representing
a large amount of replay evidence, account-constraint reasoning, and operational caution.

The active parameterization can be summarized as:


```
coremodel: validateddual source selector
targetcadence: 5 minutes
candidateslate: compact, evidence-qualified, variable count
selectedequity hard cap: none
sourceselection mode: predictionsign regime evidence
targetallocation mode: sourceconviction
actionsignal mode: sourceprovenance membership signal
retainedbaseline floor: 200 bps
primaryrole signal: 460 bps
secondaryrole signal: 348 bps
dynamicfriction multiplier primary: 0. 30
dynamicfriction multiplier secondary: 0. 30
exitreserve: 1. 00
effectiveexecution horizon: 15 minutes
rotationfunded sells: true
adaptiveaction memory enforcement: shadowonly
shadowevidence monitor: enabled
automaticsurface switching: disabled
```
The short version of why these values were chosen is:

```
Parameter Why This Value Exists
core_model = validated_dual_source_selector This is the validated source-selector family. It keeps target
construction tied to audited source models rather than an
unconstrained real-time score sort.
target_cadence = 5 minutes The replay and prospective evidence are built on 5-minute
decision bars. This is the fastest representative cadence
available for the current market-data and execution model
without pretending to observe instantaneous tradable edge.
candidate_slate = compact, evidence-qualified, variable
count
```
```
The selector begins from a compact slate, but the final target
count is not fixed. A two-name target book is valid when only
two candidates carry enough current evidence, and a one-
name book is valid when one opportunity dominates.
selected_equity_hard_cap = none Full-window source-conviction testing showed that
preserving high-conviction concentration beat forcing a hard
target cap when one selected member dominated the
expected after-cost opportunity.
source_selection_mode =
prediction_sign_regime_evidence
```
```
The selector trusts a source package only when its recent
evidence has the right sign and enough magnitude. This was
chosen to avoid switching merely because a raw historical
row looked attractive.
```

```
Parameter Why This Value Exists
target_allocation_mode = source_conviction The target book is reweighted by the selected package's own
source edge. The validation evidence showed this slightly
improved the deployable full-window result over preserving
the original scheduled weights.
retained_baseline_floor = 200 bps Retained baseline holdings receive a smaller but nonzero
edge so the system does not churn out of acceptable held
names merely because they are no longer primary source
members.
primary_role_signal = 460 bps and
secondary_role_signal = 348 bps
```
```
These are role-specific source-membership action edges from
the validated two-role surface. They replaced a single
undifferentiated source-member edge so primary and
secondary package membership could carry different
execution authority.
dynamic_friction_baseline_multiplier_primary = 0.30
and secondary = 0.30
```
```
Replay calibration found that raw source edges were too
large for direct execution gating. The 0.30 values are baseline
prior seeds for the adaptive multiplier surface; context
evidence can move the effective multiplier while the cost gate
still charges spreads, slippage, queue risk, and exit friction.
exit_reserve = 1.00 The validated practical/replay path reserves one full expected
future exit cost. The value documented here is the effective
value that actually governs entry and rotation quality.
effective_execution_horizon = 15 minutes The explicit dynamic-friction horizon is configured as zero, so
the gate derives its horizon from the 0.25 hour execution-
signal horizon: 0.25 hours times 60 minutes per hour equals
15 minutes. This is the short persistence window over which a
trade's discounted edge must beat the full after-cost hurdle;
it is not a forced delay, and it is not merely a hidden trade-
count throttle.
rotation_funded_sells = true Sell legs are allowed to fund same-package buys, matching
the executor's real ordering. This prevents the replay gate
from wrongly rejecting rotations only because cash is low
before the sell leg occurs.
adaptive_action_memory_enforcement = shadow_only The finalized practical path keeps trading behavior on the
validated baseline while the more adaptive action-memory
challenger matures in the background.
automatic_surface_switching = disabled Prospective shadow evidence can mark a challenger as ready
for review, but a financial system should not silently swap
trading surfaces without a replay/deployability audit and
explicit promotion step.
```
The model has four major practical jobs:

1. Choose the source package that should be trusted right now.
2. Convert that source package's recommendations into a target portfolio.
3. Decide whether each required order clears the practical after-cost execution gate.


4. Record clean prospective shadow outcomes so that future challengers can be judged
    causally instead of by curve-level hindsight.

The phrase "source package" matters. The practical implementation is not only asking which stock
looks best. It is asking which learned research package is currently earning trust. A source package is
a bundle of target-selection logic, evidence, and provenance. If a ticker is chosen by the active source
package, the implementation records that membership and uses it later when deciding whether the
trade has enough expected value to overcome friction.

The practical model therefore has a two-level decision structure:

```
sourcepackage t =
arg maxp evidencescore(p, regimet, historyt)
targetset t =
topk candidates(sourcepackage t, accountt, constraintst)
```
Then the execution layer asks whether the account should actually rotate into that target set:

```
executeorder j
if adjustedsource edge j
```
- frictionj
- orderstate penalty j
- waitvalue j
> 0

This is why the model can be aggressive in expected return but still deployable: raw alpha is not
enough. Alpha must survive the execution gate.

The following hierarchy is the applied model in one picture. It is deliberately drawn as a control stack
rather than a single ranking model because practical performance depends on separating belief
formation, target construction, execution permission, and promotion evidence.


```
Applied After-Cost Trading Control Stack
Targets are recommendations; actions must still beat costs, alternatives, and account constraints.
```
```
Market State
prices, returns, spreads
liquidity, volatility
```
```
Context State
events, regimes, sessions
source package evidence
```
```
Account State
positions and cash
orders and cash floor
```
```
Data Quality
freshness, coverage
staleness blockers
```
```
Bayesian Belief State And Grouped Shrinkage
Posterior means, uncertainty, group reliability, and out-of-sample evidence compress noisy signals.
The model should trust stable evidence more than isolated high historical scores.
```
```
Source Selector
chooses the current
trusted source surface
```
```
Target Gateway
selects up to five names
with weight and constraint rules
```
```
Action-Value Gate
charges spread, slippage,
queue risk, and wait value
```
```
Execution And Reconcile
route, avoid duplicates,
observe fills and repairs
```
```
Prospective Shadow Promotion Monitor
baseline remains validated while challengers mature
through clean causal outcome rows
Outcomes refresh evidence and data-quality state.
```
```
Figure 1. Hierarchical applied decision architecture.
```
##### Bayesian Hierarchy And Directed Decision Graph

The Bayesian structure is still hierarchical, but it should not be understood as a rigid tree in which
every child has exactly one parent. It is better understood as a layered directed acyclic graph for
same-time inference, plus a feedback loop from later outcomes into future beliefs.

The causal chain is:

```
rawdata t
→ featurelayer t
→ grouplayer t
→ posterioredge t
→ actiont
→ outcomet+h
```
The outcome at t+h can update the next belief state, but it cannot flow backward into the decision at
t. That one-way information rule is what makes the model causal rather than merely fitted to history.


```
Bayesian Hierarchy And Directed Decision Graph
Macroeconomic mixed-frequency shrinkage is adapted into real-time TA/FA after-cost action selection.
```
```
Raw Data
prices and bars
quotes and spread
TA and FA inputs
events and sessionportfolio state
```
```
Feature Layer
z_j = normalize(x_j)
causal z-scores
bounded lookbacks
freshness flagsclean joins
```
```
Grouped Priors
beta_g | gamma_g, tau_g
trend group
liquidity group
fundamental group
event/regime groupaction-state group
```
```
Posterior Edge
p(edge | D_t)
mean edge
variance
uncertainty discountinclusion odds
```
```
Action Gate
Q(a,t) = edge - cost
spread and slippage
queue and stale quote
hold/wait comparisoncash-only feasibility
```
```
Tree View
population prior
feature groups
ticker context
```
```
Graph View
nodes store beliefs
actions transition stateedges transmit weight
outcomes update beliefs
```
```
Realized Outcome
after-cost return
fill quality
unresolved flags
```
```
outcomes revise future posterior summaries
Directed Causal Chain
raw_data_t - > feature_layer_t - > group_layer_t - > posterior_edge_t - > action_t - > outcome_{t+h}
Every arrow points forward in information time; later outcomes can update future beliefs, but cannot alter past decisions.
```
```
Figure 2. Bayesian hierarchy and directed decision graph.
```
Figure 3 expands the left side of the graph. The important lay-person point is that "the model" is not
one undifferentiated stock score. It is a structured belief system that receives different kinds of
evidence in different places. Technical analysis, fundamental analysis, liquidity, event context,
source/provenance, portfolio state, and session state do not all mean the same thing. They enter the
Bayesian graph as separate evidence families because they have different update speeds, different
reliability patterns, and different failure modes.


```
Signal Families Entering The Bayesian Hierarchy
Different evidence types enter separate groups, are shrinkage-adjusted, then contribute to posterior after-cost edge.
```
```
TA Momentum
breakout, torquetrend, strength
TA Structure
support, extensionoversold, range
```
```
FA Quality
durable strengthgrowth, quality
Microstructure
spread, quote age
volume, capacity
Event Context
company catalyst
sector stability
State Inputs
source, portfolio
session, orders
```
```
Causal Feature Layer
z_j,i,t = transform(x_j,i,<=t)
standardize without future data
align mixed update cadences
track freshness and missingness
preserve ticker and session context
separate alpha from execution friction
Examples:
trend_score
quality_growth_score
spread_bps
source_role
target_delta
```
```
Grouped Bayesian Evidence
X_g = { z_j : j in group g }
P(gamma_g = 1 | D_t)
beta_g | gamma_g, tau_g
TA groups
FA groups
execution groups
event and regime groups
source and state groups
Shrink weak groups toward zero.
Preserve strong groups with uncertainty.
Avoid counting correlated signals twice.
```
```
Posterior Edge
p(edge_i,t,h | D_t, X, Z)
mu_edge - rho * sigma_edge
expected after-cost edge
posterior uncertainty
role and regime adjustment
```
```
Trade Gateway
Q(a,t) = edge - costs
spread, slippage, queue
quote age, wait value
cash-only feasibility
hold versus rotate
```
```
Raw signal must survive shrinkage and uncertainty.
Only then can the gateway test execution cost.
```
```
Figure 3. Signal families entering the Bayesian hierarchy.
```
The DAG was assembled this way for specific reasons.

First, it enforces causality. Raw observations at time t can influence features at time t, features can
influence grouped posterior evidence, posterior evidence can influence an action, and later outcomes
can update future beliefs. But the realized outcome at t+h cannot flow backward into the decision at
t. This direction is not merely a visual convention; it is a guard against lookahead bias.

Second, it separates mixed-frequency evidence. The 2021 MIDAS paper is built around the problem
that economic predictors arrive at different frequencies. The applied system has the same structural
problem in a trading domain. Quotes and spreads can change quickly, bars update on the trading
cadence, technical features update from recent price paths, fundamental features update slowly, and
event context updates irregularly. A flat score would blur those cadences. The graph keeps them
separate until they are normalized into causal features.

Third, it prevents double-counting correlated evidence. Trend, breakout, relative strength, and
upside torque are related. Quality, growth, and fundamental strength are related. Spread, quote age,
volume, and partial-fill risk are related. The graph therefore groups related features before allowing
them to affect posterior edge. This is the direct practical meaning of Bayesian grouped shrinkage.


Fourth, it separates belief from action. The posterior edge layer answers, "what is the expected after-
cost opportunity before the final execution decision?" The action gate answers, "is this trade worth
placing now after spread, slippage, queue risk, stale quote risk, cash-only feasibility, and the value of
waiting?" That separation is why the model can like a stock and still decline to trade it.

Fifth, it makes the computation efficient. The model can update features and group summaries once,
select a compact candidate slate, and then run the expensive action gate only on that slate. The graph
order is therefore also a compute plan: prune before action expansion.

Sixth, it makes explanations auditable. A final action can be traced backward: which raw inputs
produced which features, which feature groups were trusted, which edges carried positive value,
which costs subtracted value, and which outcome later confirmed or weakened the belief.

The hierarchy has several levels.

At the raw-data level, the model observes bars, quotes, spreads, volume, technical analysis inputs,
fundamental analysis inputs, event context, source outputs, positions, cash state, open orders, fills,
and session/calendar state. These raw observations are noisy and arrive at different cadences. A price
bar may update every few minutes, a quote may update faster, a fundamental input may update
slowly, and an event-context feature may appear irregularly.

At the feature level, raw observations become causal standardized variables:

```
zj,i,t
=
transformj(
raw_observationj,i,≤t
)
```
Examples include trend, relative strength, breakout state, spread, quote age, volume shock, quality-
growth evidence, source membership, market volatility, and current target delta. The important
point is that the transform can only use data known by time t.

At the group level, related features are bundled into evidence families:

```
Xi,t,g
=
{
zj,i,t: j belongs to group g
}
```
Groups include TA momentum, chart structure, volatility/range, liquidity, fundamental quality,
source/provenance role, event context, regime state, portfolio state, and execution telemetry. This is
the direct descendant of the 2021 MIDAS grouped-predictor idea. A group can be useful, irrelevant,


or useful only in a certain regime; the Bayesian system should learn that at the group level instead of
pretending each correlated sub-feature is an independent discovery.

At the posterior-edge level, the model turns grouped evidence into a distribution over action value:

```
p(edgei,t,h ∣ Dt-, Xi,t, 1 :G, Zi,t)
```
The decision does not depend only on the mean:

```
μedge(i,t,h)
=
𝔼[edgei,t,h ∣ Dt-]
σedge^2 (i,t,h)
=
Var(edgei,t,h ∣ Dt-)
conservativeedge(i,t,h)
=
μedge(i,t,h)
```
- ρh · σedge(i,t,h)

The uncertainty term is essential. A stock with a high point estimate and weak posterior support can
be less actionable than a stock with a smaller estimate and stronger posterior support.

At the action level, the system converts posterior edge into executable action value:

```
Q(a,t)
=
conservativeedge(a,t)
```
- executioncost(a,t)
- opportunitycost(a,t)
- operationalrisk buffer(a,t)

This is where the model stops being merely predictive and becomes a control system. A target may be
attractive but still fail the action gate if spread, stale quotes, slippage, queue risk, cash-only
feasibility, or waiting value make the trade unattractive after costs.

At the outcome/update level, realized after-cost return and fill quality become new evidence:


```
Dt
→ Dt+ 1
=
Dt
union
{
actiont,
realizedafter cost_edget:t+h,
fillquality t,
unresolvedflags t
}
```
This is the feedback loop that lets the hierarchy learn without violating causality. Outcomes update
future priors and group reliability; they do not retroactively change the past state used to make the
decision.

Graph theory is useful here because the model contains both node-level and edge-level quantities.
Node-level quantities include group reliability, posterior inclusion probability, posterior mean,
posterior variance, source role, regime state, and account state. Edge-level quantities include the
coefficient from a feature into expected edge, the source-role contribution into action edge, the
dynamic-friction multiplier that controls how much nominal edge survives into execution, and the
cost terms that subtract from action value.

So the model is a hierarchy in the Bayesian sense, but the actionable structure is a graph:

```
node weights:
how trustworthy is this belief object?
edge weights:
how strongly should this belief flow into the next decision object?
action edges:
what portfolio-state transition is worth taking after costs?
```
Figure 4 makes this distinction explicit. Node weights are reliability weights attached to belief
objects. Edge weights are transmission weights between belief objects. In a tree-only explanation,
these can be confused. In the graph view, they do different jobs:


```
nodeweight g(t):
how much should group g be trusted at time t?
edge_weightj → edge(t):
how much does indicator j move posterior edge when group g is trusted?
costedge k(a,t):
how much does cost channel k subtract from action a?
```
The simplified flow equation is:

```
belief_flowj,i,t,h
=
nodeweight g(t)
* edge_weightj → edge(t,h)
* zj,i,t
```
and the final action value is:

```
Q(a,t)
=
αt
+ ∑j belief_flowj,i,t,h
+ sourcerole_flowi,t
```
- uncertainty_penaltyi,t,h
- ∑k costedge k(a,t)

That equation is deliberately more understandable than the full posterior. It says: trust the relevant
evidence groups, let their weighted edges contribute to expected value, subtract uncertainty, subtract
real execution frictions, and trade only if the resulting action beats the alternatives.


```
Node Weights And Edge Weights In The Bayesian Action Graph
Node weights decide how trustworthy a belief object is; edge weights decide how strongly it moves the next layer.
```
```
Node Weight
trust_g(t) = P(gamma_g= 1 | D_t)
* quality_g(t)
* stability_g(t)
answers: should this group matter?
examples: sample depth, posteriorvariance, freshness, group fit
```
```
TA Group
trend, breakout
trust_TA
```
```
FA Group
quality, growth
trust_FA
```
```
Edge Weight
w_{j - > edge} = E(beta_j | D_t)
flow_j = trust_g * w_j * z_j
answers: how strongly does this evidencemove the posterior edge?
```
```
Positive Alpha Flow
sum_j trust_g * beta_j * z_j
TA/FA/source contributions
```
```
Negative Cost Flow
```
- C_k(a,t)
**spread, slippage, queue**

```
Posterior Action Edge
mu_edge = alpha + sum flows
conservative_edge = mu - rho*sigma
mean edge is useful only after
posterior uncertainty is charged
```
```
Executable Action Value
Q(a,t) = conservative_edge
```
- execution_cost - wait_value
    **trade only if action beats
hold, wait, and alternatives**

```
calibrates
```
```
edge weights adds evidence
```
```
subtracts costs
```
```
posterior action value = node trust * evidence edge weights - uncertainty - execution friction
```
```
Figure 4. Node weights and edge weights in the Bayesian action graph.
```
That distinction matters. The 2021 paper mostly inspires the group/node shrinkage: which predictor
blocks should matter and how much uncertainty should shrink them. The applied trading system
adds explicit edge weights into the action graph: how evidence passes from TA/FA/source/regime
groups into posterior edge, then through dynamic friction and the trade gateway into a real action.

### 54. Feature Groups And Bayesian Research Layer

The current practical strategy is not a full online Bayesian posterior sampler, but the research layer
contains a Bayesian factor posterior used to study which features deserve promotion into more
complete testing. This layer is important because it translates a large feature universe into posterior
statements such as "likely helpful," "uncertain," "probably harmful," or "needs interaction testing."

Suppose the research target is future after-cost return in basis points:

```
yi,t,h
= realizedforward return bps(i,t,h)
```
- estimatedentry cost bps(i,t)
- estimatedexit cost bps(i,t+h)
- slippagebps(i,t)


Let xi,t be a vector of standardized features:

```
zi,t,k =
(xi,t,k - meank) / sdk
```
The ridge-style walk-forward model is:

```
y = X β + ε
ε ∼ 𝒩( 0 , σ^2 I)
βhat_λ =
(X′X + λ I)-^1 X′y
```
The walk-forward discipline is essential. For each test segment, the model trains only on data that
would have been known before that segment. It can also purge nearby sessions so that adjacent
observations do not leak future state into the past. The implementation's practical question is not
"can this fit history?" It is "would this have made a better decision using only prior information?"

The Bayesian posterior variant begins with a Gaussian prior:

```
β ∼ 𝒩( 0 , σ_β^2 I)
y ∣ X, β ∼ 𝒩(X β, σ^2 I)
```
After centering the target, the posterior precision is:

```
Λpost =
Xz' Xz / σ^2
+ I / σ_β^2
```
The posterior covariance is:

```
Vpost = Λpost-^1
```
The posterior mean is:

```
mpost =
Vpost Xz' ycentered / σ^2
```
For feature k, the posterior distribution is:

```
βk ∣ data ∼ 𝒩(mk, Vk,k)
```
The posterior probability that the feature is positive is:


```
ℙ(βk > 0 ∣ data)
= Φ(mk / √(Vk,k))
```
and the posterior probability that it is negative is:

```
ℙ(βk < 0 ∣ data)
= Φ(-mk / √(Vk,k))
```
The utility-adjusted research score is:

```
utilityk =
mk - ρ · √(Vk,k)
```
where ρ is an uncertainty penalty. In plain English: a feature is valuable only if its estimated benefit
remains meaningful after subtracting a penalty for not knowing enough yet.

This differs from a naive feature ranking. A naive ranking might promote a feature because its
historical average was high. The Bayesian layer asks how much posterior mass supports the feature
after shrinkage. A feature with a large point estimate but huge uncertainty can be less attractive than
a smaller effect with tight posterior support.

That is the direct connection to the 2021 Bayesian MIDAS paper. The applied system sees many
related, noisy, partially redundant signals. The Bayesian discipline says to use grouped structure,
shrinkage, and posterior predictive uncertainty before allowing a signal to affect capital.

### 55. Grouped Shrinkage In The Applied Trading Setting

The practical and research feature space is naturally grouped. Examples include:

```
raw momentum, centered momentum, and momentum interaction features;
liquidity and spread features;
volatility and ATR beta features;
breakout and chart-structure features;
source package membership indicators;
semantic or news-derived conviction indicators;
event context indicators;
account-state features such as current weight, target delta, and cash
availability.
```
Figure 5 shows the modeling role of those groups. The important point is that the practical selector
should not treat every feature as an isolated vote. It should first ask whether the feature's group has
earned reliability, whether the feature's coefficient survives shrinkage, and whether its posterior
uncertainty is low enough to justify capital.


```
Grouped Bayesian Shrinkage Under The Applied Selector
The selector elevates signals that survive both group-level shrinkage and posterior uncertainty.
```
```
Population Prior
beta weak evidence is pulled toward zero _g | tau_g, gamma_g ~ shrinkage prior
```
```
Price Action
momentum
breakout structure
```
```
Liquidity
spread, volume
fill reliability
```
```
Source Role
primary, secondary
retained baseline
```
```
Event Regime
session, catalyst
macro context
```
```
Account State
cash, current weight
target delta
```
```
Ticker-Context Posterior
E[y_i,t,h | I_t] = x_i,t' m_post
uncertainty_i,t = sqrt(x_i,t' V_post x_i,t)
```
```
Predictive Value
expected forward return
conditional on current state
```
```
Uncertainty Discount
posterior variance, sample depth
and deployment realism
```
```
action edge = predictive value - uncertainty penalty - execution friction
```
```
Figure 5. Grouped Bayesian shrinkage under the applied selector.
```
An applied grouped model can be written as:

```
yi,t,h
= α
+ ∑g= 1 G Xi,t,g βg
+ εi,t,h
```
with group-level shrinkage:

```
βg ∣ τg, γg
∼ 𝒩( 0 , γg τg^2 Ig + ( 1 - γg) εspike Ig)
```
The practical approximation does not need to sample this exact distribution on every 5-minute loop.
It can maintain cached group-level reliability summaries:


```
groupreliability g =
f(
posteriormean g,
posteriorsd g,
outof sample hit rate g,
costadjusted forward edge g,
samplecount g,
regimecondition g
)
```
Those summaries can then shape selection and execution without forcing the practical trading loop
to solve a full high-dimensional Bayesian model every time.

The key applied insight is that "sector" should not be treated only as a human industry label. A better
model treats sector-like structure as any learned latent dependency group:

```
groupg could be:
industry sector,
liquidity cluster,
volatility cluster,
macro sensitivity cluster,
source-package cluster,
execution-cost cluster,
event-response cluster,
residual co-movement cluster
```
The practical covariance target is therefore:

```
Σ
= Bmarket Ωmarket Bmarket'
+ Bgroup Ωgroup Bgroup'
+ Bstyle Ωstyle Bstyle'
+ Bevent Ωevent Bevent'
+ Didiosyncratic
+ Ssparse residual
```
where:

```
Bmarket maps stocks to broad market exposure;
Bgroup maps stocks to learned groups;
```

```
Bstyle maps stocks to style factors such as momentum, volatility, and
quality;
Bevent maps stocks to event and news exposure;
Didiosyncratic captures ticker-specific variance;
Ssparse residual captures residual pairwise dependencies that are too
strong to ignore.
```
This covariance model is not merely decorative. It matters because the best individual names are not
necessarily the best portfolio. If the leading candidates are all expressions of the same hidden risk,
then the portfolio is less diversified than it appears. Bayesian grouped shrinkage helps the system
avoid mistaking repeated versions of the same bet for independent evidence.

##### Full Bayesian Calculation Stack

The equations above describe the intuition. The applied model can also be written in the fuller style
of the 2021 Bayesian MIDAS penalized-regression paper: define the data-generating object, group
the predictors, place shrinkage priors on those groups, derive the posterior, then make decisions
from the posterior predictive distribution rather than from a raw point estimate.

The observed training record is:

```
Dt
=
{
yn,
Xn, 1 :G,
cn,
qn,
rn,
pn,
an
}_{n ≤ t}
```
where:


```
yn:
realized after-cost edge in basis points for resolved observation n
Xn,g:
standardized predictor block for feature group g
cn:
observed cost vector for the candidate action
qn:
quote, liquidity, and session-quality state
rn:
role or provenance class
pn:
source package identity or source family
an:
action type, such as buy, sell, rotate, replace, cancel, or hold
```
The target is not raw return. The target is the value that would have mattered at the trading gate:

```
yn
=
realizedforward return bps(n)
```
- realizedentry cost bps(n)
- realizedexit or markout cost bps(n)
- realizedslippage bps(n)
- realizedqueue delay value bps(n)
- realizedopportunity cost bps(n)

This is the first important difference from a naive alpha model. The model is not trying to predict
"which stock went up." It is trying to predict whether an action would have increased account value
after the practical costs of trading.

The grouped regression form is:


```
yn
=
α
+ ∑g= 1 G Xn,g βg
+ Zn δ
+ εn
εn ∣ σ^2
∼ 𝒩( 0 , σ^2 / wn)
```
Here Zn contains lower-dimensional context terms such as provenance role, source package, action
type, and session bucket. The weight wn lets cleaner observations count more than noisy
observations:

```
wn
=
f(
quotefreshness n,
spreadquality n,
fillresolution n,
missingdata flags n,
orderstate cleanliness n
)
```
A fully resolved regular-session action with fresh quotes receives more weight. A row with stale
quotes, missing spread information, partial unresolved fills, or uncertain account state receives less
weight. This is a practical analogue of the paper's concern with posterior predictive reliability: the
model should not treat every observation as equally informative when the observation quality is
visibly different.

The grouped prior mirrors the 2021 paper's group-lasso and spike-and-slab logic. For feature group
g:


```
βg ∣ γg, τg^2 , σ^2
∼
γg 𝒩( 0 , σ^2 τg^2 Ig)
+ ( 1 - γg) δ 0 (βg)
γg ∣ πg
∼ Bernoulli(πg)
πg
∼ Β(a_πg, b_πg)
τg^2 ∣ λg
∼ Γ((dg + 1 ) / 2 , λg^2 / 2 )
σ^2
∼ Inv-Γ(a_σ, b_σ)
```
The terms mean:

```
γg:
whether group g is allowed to matter
δ 0 (βg):
a point mass at zero, meaning the group is excluded
τg:
group-specific slab scale, meaning how large included coefficients may be
λg:
group shrinkage strength
πg:
prior inclusion probability for the group
```
This is the formal version of "do not treat every raw feature as an independent vote." A group can be
excluded, included but strongly shrunk, or included with enough posterior mass to affect the
predictive distribution. The group is the unit of shrinkage because many trading features are
internally correlated: raw momentum, smoothed momentum, lagged momentum, and volatility-
adjusted momentum are not four independent discoveries.

The joint posterior is:


```
p(
α,
β 1 :G,
δ,
γ 1 :G,
τ 1 :G^2 ,
π 1 :G,
σ^2
| Dt
)
proportionalto
p(y ∣ X, Z, α, β, δ, σ^2 , W)
* p(σ^2 )
* p(δ)
* productg= 1 G
p(βg ∣ γg, τg^2 , σ^2 )
p(γg ∣ πg)
p(πg)
p(τg^2 ∣ λg)
```
where the weighted likelihood is:

```
p(y ∣ X, Z, α, β, δ, σ^2 , W)
=
productn= 1 N
N(
yn
|
α
+ ∑g= 1 G Xn,g βg
+ Zn δ,
σ^2 / wn
)
```
Conditional on an active group set A, the Gaussian block of the posterior has the familiar precision
form:


```
θA
=
(
α,
βA,
δ
)
ΛA
=
XA' W XA / σ^2
+ V 0 ,A-^1
VA
=
ΛA-^1
mA
=
VA
(
XA' W y / σ^2
+ V 0 ,A-^1 m 0 ,A
)
θA ∣ Dt, A, σ^2
∼ 𝒩(mA, VA)
```
This is the same mathematical pattern as the smaller ridge posterior earlier in the paper, but it is now
group-aware, observation-quality-aware, and context-aware. The active-set posterior and the spike-
and-slab inclusion posterior combine into a model-averaged prediction:

```
p(y* ∣ x*, z*, Dt)
=
∑A
p(y* ∣ x*,A, z*, Dt, A)
p(A ∣ Dt)
```
In a fast practical implementation, the model does not enumerate every possible active set on every
decision tick. It approximates the same object through cached group posterior summaries:


```
posteriorgroup summary g
=
(
ℙ(γg = 1 ∣ Dt),
𝔼[βg ∣ Dt],
Var(βg ∣ Dt),
𝔼[τg ∣ Dt],
neffective g,
lastvalid update g
)
```
The posterior predictive mean for candidate action a is:

```
μedge(a,t)
=
𝔼[y* ∣ xa,t, za,t, Dt]
```
The posterior predictive variance is:

```
σedge^2 (a,t)
=
𝔼[σ^2 ∣ Dt]
+ xa,t' Var(θ ∣ Dt) xa,t
+ σmodel misspecification^2 (a,t)
```
The third term is deliberately explicit. In a practical trading implementation, uncertainty does not
come only from coefficient variance. It also comes from model misspecification, stale data, market
microstructure effects, and distribution shift. The applied model therefore treats predictive
uncertainty as:

```
σtotal^2 (a,t)
=
σedge^2 (a,t)
+ σquote staleness^2 (a,t)
+ σliquidity state^2 (a,t)
+ σorder state^2 (a,t)
+ σregime shift^2 (a,t)
```
The uncertainty-discounted Bayesian edge is:


```
edgeconservative bps(a,t)
=
μedge(a,t)
```
- zq · σtotal(a,t)

where zq is a quantile-style caution parameter. For example, a larger zq means the gate uses a lower
credible bound rather than the posterior mean. In plain language: the system asks whether the trade
still looks good after penalizing the fact that it might be wrong.

The posterior probability that action a has positive after-cost value before the explicit execution-cost
gate is Ppositive(a,t) = ℙ(edgea > 0 ∣ Dt). For a normal posterior approximation, it is evaluated as
1 - Φ(( 0 - μedge(a,t)) / σtotal(a,t)).

The posterior probability that action a beats the explicit cost hurdle Ha(t) is
Pclears hurdle(a,t) = ℙ(edgea > Ha(t) ∣ Dt). For the same normal approximation, it is evaluated as
1 - Φ((Ha(t) - μedge(a,t)) / σtotal(a,t)).

The practical action score can then be written as:

```
bayesianaction surplus bps(a,t)
=
edgeconservative bps(a,t)
```
- Ha(t)

The deterministic gate used in the fast path is the practical approximation of that Bayesian decision:

```
trade
if bayesianaction surplus bps(a,t) > 0
and Pclears hurdle(a,t) is high enough
and account/order constraints pass
```
This is the most important conceptual bridge from the 2021 paper to the applied trading model. The
2021 paper uses grouped Bayesian shrinkage to improve selection and prediction under high-
dimensional, mixed-frequency conditions. The applied model uses the same statistical discipline, but
the object being predicted is after-cost action value, and the final decision is constrained by execution
cost, account state, order state, and deployability.

### 56. Source Package Selection

The practical source selector uses prediction-sign regime evidence. At a high level, each source
package makes claims about which targets should work. The selector evaluates whether those claims
have recently had the right sign and enough forward value to remain trusted.


Let p index source packages. Let rt be the current regime condition. Let Gp,t be the evidence score for
package p at time t. A simplified selector is:

```
Gp,t
= decay · Gp,t- 1
+ realized_evidencep,t
```
where:

```
realized_evidencep,t
=
sign(predictionp,t)
* realizedafter cost_returnp,t,h
```
The active package is selected when its evidence clears the required standard:

```
p*t =
arg maxp Gp,t
use p*t if Gp*t,t ≥ evidencethreshold bps
```
The current practical threshold is 95 basis points. The decay is currently 1.0, meaning the relevant
evidence window is not faded by an exponential decay term in this active configuration.

These are calibration values, not theoretical constants. The 95 bps threshold is the promoted
selector's evidence hurdle: low enough to keep the trusted source package active when its regime
evidence is genuinely positive, but high enough to avoid switching on small noisy advantages. The
decay value of 1.0 means the active surface preserves the replay-tested evidence window rather than
adding an extra exponential recency preference that was not part of the promoted full-window
deployability result.

The active source stack preserves the validated baseline behavior. It uses a primary evidence role and
a secondary evidence role. The conceptual distinction is simple: the primary source is the higher-
conviction current source model, and the secondary source is an additional source model that can
contribute target membership and role-specific execution evidence. The selector is not only asking
whether a ticker looks good; it is asking which learned source of ticker recommendations currently
deserves authority.

### 57. Target Portfolio Gateway

Once the source package is selected, the target gateway converts candidates into a portfolio. The
finalized gateway is not a fixed-count or equal-weight portfolio builder. It receives a compact
candidate slate, removes names that do not survive current tradability and evidence checks, and then


allocates among the remaining selected members by source conviction. If only two equities survive,
the target portfolio can be a two-equity book. If one equity dominates the positive after-cost
opportunity, the target can concentrate heavily in that one name. A fixed maximum-position cap is
not part of this finalized gateway.

Let Ct be the candidate set emitted by the active source package. Let si,t be the scheduled source-
package weight for ticker i, and let pi,t be its source-package prediction in basis points. The active
tradable set is:

```
At = {i in Ct : pricei,t is fresh and positive}
```
The source-conviction boost is:

```
bi,t
=
max(pi,t - pmin, 1 )^γ, if pi,t > pmin
1 , otherwise
```
The gross target exposure is inherited from the selected source package:

```
Gt = min( 1 , sumj in A t sj,t)
```
The source-conviction target weight is:

```
wi,t
=
Gt *
si,t bi,t
/ sumj in A t sj,t bj,t
```
With the current γ = 1 , pmin = 0 , and no fixed-count truncation, a single name can receive nearly all
of Gt if it dominates the positive source-conviction score. This is intentional. It expresses the model's
view that forced diversification is not free: if the best estimate of after-cost geometric return is
concentrated, the target should be concentrated too. The trade execution layer then decides how
much of that desired target can be prudently reached now.

Those source-conviction constants came from a direct replay comparison. Linear edge weighting
(γ = 1 ) preserved the selected source package's information without exaggerating the largest current
prediction. Stronger weighting (γ = 3 ) was rejected because it overconcentrated on prediction
magnitude and lowered full-window return. Hard top-N truncation was also rejected because it threw
away useful selected-package membership. The active path therefore uses no fixed-count cutoff and
no positive EV floor beyond the source package's own positive prediction handling.


Cash remains the residual when the selected source package does not allocate the full book or when
downstream account/execution state prevents immediate movement toward the target. In practice,
cash is not treated as a failure by default. Cash can be the optimal state when the available trades do
not clear after-cost execution hurdles.

The target gateway is deliberately upstream from execution. It says:

```
"If trading were sufficiently cheap and state were clean,
this is the portfolio the model would prefer."
```
The execution gateway then says:

```
"Given actual costs, current holdings, brokerage state, and order queue state,
which moves toward that portfolio are worth making now?"
```
This distinction prevents two common errors:

1. Treating a target as an unconditional order.
2. Treating a failed execution gate as evidence that the target was bad.

A target can be correct while a specific order is not worth placing at the current spread. Likewise, an
order can be executable because it repairs risk or cash state even if it is not the highest-alpha
theoretical action.

### 58. Provenance Membership Action Signal

The current action signal mode is sourceprovenance membership signal. This means that the execution layer
gives an action edge to tickers that are members of the active source package target set, with different
values depending on their role.

Let:

```
Mi(t) be the provenance membership role for ticker i at time t.
primary mean the ticker is selected by the primary package role.
secondary mean the ticker is selected by the secondary package role.
retained mean a currently held baseline name remains acceptable but is not
a primary or secondary source member.
```
The practical membership edge is:


```
sourcemember edge bps(i,t) =
460 , if Mi(t) = primary
348 , if Mi(t) = secondary
200 , if Mi(t) = retainedbaseline
0 , otherwise
```
This is not the final executable alpha. It is the source-provenance claim that the execution gate
receives. The gate then discounts this claim through dynamic friction and compares it with real
trading costs.

The values are deliberately ordered. Primary package membership receives the largest edge because
it is the most trusted current source role. Secondary membership receives a smaller edge because it is
useful evidence but not the dominant source authority. Retained baseline membership receives a
smaller floor so the system can avoid unnecessary churn out of already-held names that remain
acceptable. These values are replay-calibrated action priors, not standalone return forecasts.

The conceptual purpose is subtle but important. In earlier forms, all targets could inherit a broad
membership signal. The provenance-aware version asks which source actually placed the name in the
target set. That prevents a non-causal target membership artifact from being treated as tradeable
edge.

The membership signal can be written as a prior over action value:

```
𝔼[actionedge i ∣ provenancei]
= brole(provenancei)
```
where:

```
brole(primary) = 460 bps
brole(secondary) = 348 bps
brole(retainedbaseline) = 200 bps
brole(none) = 0 bps
```
This is a practical Bayesian prior. It says that, conditional on being selected by the current source
package role, the action has a positive prior edge. But because the prior is then passed to a friction-
adjusted execution gate, role membership alone is not sufficient to trade.

##### How The Bayesian Role Priors Are Calculated

The role priors are stored as basis-point action edges, but their conceptual status is Bayesian: each
provenance role is treated as a latent action-value class whose true edge is uncertain. The model asks,
"Given the evidence that a ticker entered the target through this role, how much prior edge should
the execution gate provisionally credit before costs?"


Let r denote a provenance role:

```
r ∈ {primary, secondary, retainedbaseline, none}
```
Let θr be the latent after-cost action edge associated with role r before dynamic-friction discounting.
A full Bayesian model would maintain:

```
p(θr ∣ Dreplay, Dshadow)
proportionalto
p(Dreplay, Dshadow ∣ θr) · p(θr)
```
where Dreplay is the causal full-window replay evidence and Dshadow is the set of clean resolved shadow
observations. The practical implementation uses a compact approximation:

```
sourcemember edge bps(i,t)
=
brole(Mi(t))
brole(r)
=
conservativerepresentative point(
posteriorplateau r
)
```
In words: the role-specific Bayesian prior is the conservative representative point from a plateau of
replay-supported action values. It is not the single highest noisy tick in a short run, and it is not a
hand-entered confidence number. It is selected only after the same execution surface, target source,
order-state proxy, and deployability rules are held fixed.

For the primary role, the broad source-membership surface was first narrowed around the winning
region. The local bracket was:

```
455 bps → 1037. 064021 percent annualized after-cost return
458 bps → 1038. 794167 percent annualized after-cost return
459 bps → 1038. 825237 percent annualized after-cost return
460 bps → 1038. 995427 percent annualized after-cost return
461 bps → 1038. 995427 percent annualized after-cost return
462 bps → 1038. 808247 percent annualized after-cost return
465 bps → 1038. 808247 percent annualized after-cost return
470 bps → 1012. 943303 percent annualized after-cost return
```

The 460 and 461 bps rows tied under the discrete execution state machine. The model therefore
chooses 460 bps: the lower of the tied values, which preserves the same observed return while asking
slightly less of the action edge prior.

For the secondary role, the primary prior was held at 460 bps and the secondary prior was swept on
the same surface:

```
primary= 460 , secondary= 320 → 1039. 706152 percent annualized after-cost return
primary= 460 , secondary= 340 → 1040. 615335 percent annualized after-cost return
primary= 460 , secondary= 345 → 1043. 294209 percent annualized after-cost return
primary= 460 , secondary= 348 → 1043. 294209 percent annualized after-cost return
primary= 460 , secondary= 350 → 1043. 294209 percent annualized after-cost return
primary= 460 , secondary= 352 → 1042. 806548 percent annualized after-cost return
primary= 460 , secondary= 355 → 1042. 774181 percent annualized after-cost return
primary= 460 , secondary= 360 → 1042. 219407 percent annualized after-cost return
primary= 460 , secondary= 460 → 1038. 995427 percent annualized after-cost return
```
The 345, 348, and 350 bps values formed a flat posterior plateau in the replay surface. The model
chooses 348 bps because it is the center of that plateau, not a boundary value. This is a shrinkage-
friendly choice: it accepts the secondary role's evidence, but it avoids treating the secondary source as
equal to the primary role.

The retained-baseline prior is calculated differently because it does not represent a newly selected
source member. It is a churn-control floor for a currently held name that remains acceptable. The
same-surface retained-baseline bracket found the strongest full-window point at 200 bps, so:

```
brole(retainedbaseline) = 200 bps
```
That floor says, "Do not churn out of an already-held acceptable name unless the replacement clears
the full action-value gateway." It does not mean the retained baseline name has the same evidence
strength as a fresh primary source member.

Finally:

```
brole(none) = 0 bps
```
A ticker with no current provenance membership receives no synthetic source-membership action
edge. It may still be traded for account repair, liquidity, cash, or order-state reasons, but it does not
receive this Bayesian role prior.


### 59. Dynamic Friction And The Trading Gate

Dynamic friction is the practical layer that turns a target recommendation into a trade/no-trade
decision. It exists because a strategy does not get paid for being right in a frictionless simulation. It
gets paid only if the account is better after spreads, slippage, missed fills, order queue effects, and
opportunity cost.

The dynamic-friction multiplier surface begins from validated baseline seeds:

```
primarybaseline multiplier = 0. 30
secondarybaseline multiplier = 0. 30
retainedbaseline multiplier = 0. 30
```
These seed values are the prior mean of the adaptive multiplier surface, not a claim that every role,
ticker, and market state should always receive exactly the same trust discount. The runtime
multiplier is:

```
dynamicfriction multiplier(i,t)
=
m(
rolei,
regimet,
tickeri,
liquidityt,
sourcepackage t,
executionquality t
)
```
and the multiplier converts source membership edge into executable model edge:

```
effectivemodel edge bps(i,t)
= sourcemember edge bps(i,t)
* dynamicfriction multiplier(i,t)
```
At the baseline seed, before context-specific adjustment, the effective edges are:


```
primary effective edge:
460 · 0. 30 = 138 bps
secondary effective edge:
348 · 0. 30 = 104. 4 bps
retained baseline effective edge:
200 · 0. 30 = 60 bps
```
The 0.30 seed should not be read as saying the model is only 30 percent confident in a philosophical
sense. It is an empirical prior for the fraction of nominal source edge that should count against
practical execution friction before the context update is applied. A multiplier of 1.00 would trust the
raw source edge fully. A multiplier of 0.00 would ignore it. A multiplier seeded at 0.30 says the
source package is useful, but the execution gate begins by discounting the nominal source edge by 70
percent and then moves that trust level up or down when regime, liquidity, ticker, and realized
execution evidence justify it.

The reason the primary and secondary baseline seeds both start at 0.30 is empirical: the validated
two-role surface used role-specific nominal edges, then applied the same fractional trust calibration
to both roles. That keeps the role distinction in the nominal edge itself while letting the adaptive
multiplier surface express finer context differences after the baseline prior is set.

The buy-side gate can be written as:

```
buy if:
effectivemodel edge bps
```
- expectedspread bps
- expectedslippage bps
- expectedmarket impact bps
- partialfill penalty bps
- missedfill penalty bps
- orderqueue penalty bps
- waitvalue bps
- riskpenalty bps
> 0

The sell-side gate is not simply the negative of the buy gate. A sell can be valid because it exits a name
that no longer belongs in the target set, because it funds a better target, because it repairs overweight
exposure, or because it reduces brokerage-state risk. The applied sell comparison is:


```
sell if:
valueof freeing capital
+ valueof reducing bad or stale exposure
+ valueof funding target rotation
```
- exitfriction
- replacementrisk
> valueof holding

The practical implementation supports rotation-funded sells. That means a buy-entry hurdle cannot
look only at current cash. If the executor can sell first and then fund a buy, the affordability
calculation must include eligible sell-funded cash. The correct applied action is a package of feasible
account moves, not a naive "cash now or no trade" test.

Figure 6 summarizes the same logic as a gate. The tree should be read from the top down: a target
delta is only an input. It becomes a trade only after state freshness, provenance or repair authority,
full action value, and order-state constraints all agree.


```
After-Cost Trading Gate As A Decision Tree
A target delta becomes an order only if it survives state, evidence, value, and account constraints.
Candidate Target Delta
desired move toward selected target portfolio
```
```
Fresh data and valid
account state?
```
```
Wait/Repair No
refresh state or
clear blocker
```
```
Yes
```
```
Provenance edge or
repair value exists?
```
```
Hold/Cash No
target does not earn
action authority
```
```
Yes
Compare Full Action Value
Q(action) versus hold, wait, cash, repair, and alternate rotation
after spread, slippage, queue risk, and opportunity cost
```
```
Wait Not positive
cash option or hold
```
```
PositiveOrder constraints
allow it?
```
```
Yes
Route Order And Observe
fills update reconciliationand shadow outcomes
```
```
No
Resize / Queue / Repair
fit cash floor, open orders, and limits
```
```
Figure 6. After-cost action gate decision tree.
```
The current exit reserve is 1.00. Exit reserve is the amount of future exit friction the system reserves
when evaluating entry or rotation quality. This document records the effective reserve that governs
the finalized trading gate, not a theoretical placeholder or an unused stricter setting.

##### Individual Cost Components In The Trade Gateway

All gateway costs are expressed in basis points of the action notional unless otherwise stated. The
cost oracle starts with the proposed target delta:

```
notional
=
abs(target_δdollars)
```
Then it normalizes market inputs:


```
spreadbps
=
min( 1000 , max( 0 , spreadpct) · 100 )
volatilitybps
=
max( 0 , volatilitypct) · 100
sizeratio
=
notional / bardollar volume,
if bardollar volume > 0
1 ,
if bardollar volume is missing and notional > 0
0 ,
otherwise
```
The liquidity and capacity charge grows with the square root of action size relative to recent bar
liquidity:

```
liquiditycapacity risk bps
=
min(
120 ,
0. 25 + 9 · √(min( 9 , sizeratio))
)
```
If recent bar liquidity is missing while the action has positive notional, the model refuses to treat the
absence of data as free liquidity:

```
liquiditycapacity risk bps
=
max(liquiditycapacity risk bps, 35 )
```
Quote staleness is charged separately. The first eight seconds are treated as fresh enough for the
short-horizon gate. After that, the charge ramps:


```
if quoteage seconds > 60 :
stalequote risk bps
=
min( 80 , 4 + (quoteage seconds - 60 ) / 10 )
else if quoteage seconds > 8 :
stalequote risk bps
=
min( 20 , (quoteage seconds - 8 ) / 6 )
else:
stalequote risk bps = 0
```
Holiday, weekend, overnight, early-close, and restricted-session effects enter through two channels.
First, the session can multiply normal side cost because liquidity is thinner outside the best regular-
hours window. Second, a gap charge is added when the next normal trading session is farther away:

```
gaprisk bps
=
clamp((gapdays to next trading session - 1 ) · 1. 75 , 0 , 25 )
```
The base one-side cost is:

```
baseside cost bps
=
(
0. 5 · spreadbps
+ 0. 10 · min( 200 , volatilitybps)
+ liquiditycapacity risk bps
+ stalequote risk bps
+ recentfill slippage bps
)
* sessionmultiplier
+ gaprisk bps
```
This formula is intentionally conservative but not frozen. The half-spread term charges the expected
cost of crossing or working inside the spread. The volatility term charges near-term mark movement.
Liquidity capacity charges oversized actions. Stale quotes charge uncertainty in the observed price.
Recent realized slippage lets the system learn from its own fills. Session and gap terms prevent
illiquid windows and market-closure gaps from looking cheaper than they are.

Entry and exit costs are then action-specific:


```
expectedentry cost bps
=
baseside cost bps,
for BUY, ROTATE, or REPLACE
0 ,
otherwise
expectedexit cost bps
=
baseside cost bps,
for SELL, ROTATE, or REPLACE
0. 85 · baseside cost bps,
otherwise
```
For a fresh buy, the future exit estimate is further scaled before reserve application:

```
if action = BUY:
expectedexit cost bps
=
0. 65 · expectedexit cost bps
```
The reserved future exit cost is:

```
reservedfuture exit cost bps
=
expectedexit cost bps
* clamp(futureexit cost reserve fraction, 0 , 1 )
```
With the finalized effective reserve at 1.00, the gate reserves the full modeled future exit cost after the
buy-specific scaling. A larger requested reserve is clipped at the representable maximum rather than
silently creating an unbounded cost term.

Order queue delay is charged for buy, sell, rotate, and replace actions:


```
queuedelay risk bps
=
min(
60 ,
0. 8
+ 12 · sizeratio
+ 4. 5 · max( 0 , sessionmultiplier - 1 )
)
```
Cancel and replace risk is charged when the action mutates an existing working order or when open-
order state already exists:

```
cancelreplace risk bps
=
min(
60 ,
apibudget cost bps
+ lostqueue priority bps
+ max( 0 , sessionmultiplier - 1 )
)
```
Same-ticker reversal memory is not a fixed cooldown. When enabled, it charges the still-relevant cost
of reversing a recent opposite-side fill and lets that charge decay over the model's own horizon:

```
actionmemory horizon seconds
=
predictedholding seconds,
if predictedholding seconds > 0
edgehorizon minutes · 60 ,
otherwise
actionmemory cost bps
=
max(recentsame ticker fill cost bps, fallbackround trip cost bps)
* exp(-recentsame ticker fill age seconds / actionmemory horizon seconds)
```
If action memory is disabled, if there is no recent opposite-side fill, or if no valid horizon exists, this
term is zero. In the finalized practical surface, the adaptive action-memory enforcement term is not
the active source of edge; it is kept as an explicitly modeled cost channel for shadow evaluation and
future promotion evidence.


The dynamic-friction conversion happens before the cost gate:

```
modeledge bps
=
sourcemember edge bps
* dynamicfriction multiplier(role)
```
Then action type determines the gross edge and the relevant costs:


BUY or ROTATE:
grossaction edge bps
=
modeledge bps - cashwaiting value bps
actioncost bps
=
expectedentry cost bps
+ reservedfuture exit cost bps or rotation exit cost bps
+ queuedelay risk bps
+ actionmemory cost bps

SELL:
grossaction edge bps
=
cashwaiting value bps - modeledge bps
actioncost bps
=
expectedexit cost bps
+ queuedelay risk bps
+ actionmemory cost bps

REPLACE:
grossaction edge bps
=
replacementimprovement bps
actioncost bps
=
cancelreplace risk bps
+ queuedelay risk bps
+ actionmemory cost bps

CANCEL:
grossaction edge bps
=
replacementimprovement bps
actioncost bps
=
cancelreplace risk bps


Finally:

```
minimumrequired edge bps
=
max(
minimumhurdle bps,
actioncost bps + operationalrisk bps
)
effectivenet edge bps
=
grossaction edge bps - minimumrequired edge bps
```
A new buy, sell, rotate, or replace action is permitted only when:

```
effectivenet edge bps > 0
```
This is the practical meaning of the trade gateway. The target model proposes a desired portfolio, the
Bayesian role prior and dynamic-friction multiplier produce a model edge, and each cost channel
asks whether the proposed action still improves the account after real execution frictions and the
value of waiting are charged.

##### Full Gateway Cost Algebra

The previous subsection lists the cost components. The complete gate can be written as a cost-
bearing statistical decision problem. For every possible action a at time t, define the action-state
vector:


```
G(a,t)
=
(
sidea,
notionala,
currentposition value a,
target_δa,
quoteage a,
spreada,
volatilitya,
bardollar volume a,
sessiona,
gapdays a,
openorder state a,
recentfill state a,
cashwaiting value a,
accountconstraint state a
)
```
The gateway converts G(a,t) into a hurdle:

```
Ha(t)
=
minimumrequired edge bps(a,t)
```
and compares it with a gross action edge:

```
Sa(t)
=
grossaction edge bps(a,t)
```
The action can be taken only if:

```
Sa(t) - Ha(t) > 0
```
The important point is that Ha(t) is not a single fudge factor. It is an explicit sum of individually
interpretable costs:


```
Ha(t)
=
max(
Hmin(a,t),
Caction(a,t) + Coperational(a,t)
)
```
where:

```
Hmin(a,t):
minimum edge floor, usually zero unless governance sets a stricter floor
Caction(a,t):
action-specific execution, queue, reversal, and mutation cost
Coperational(a,t):
residual operational risk buffer
```
The base market inputs are normalized first:

```
Na
=
|target_δdollars a|
sa
=
min( 1000 , 100 · max( 0 , spreadpct a))
va
=
100 · max( 0 , volatilitypct a)
ua
=
Na / dollarvolume a,
if dollarvolume a > 0
1 ,
if dollarvolume a = 0 and Na > 0
0 ,
otherwise
```

Here sa is spread in basis points, va is short-horizon volatility in basis points, and ua is the action's
size relative to recent bar liquidity. The liquidity/capacity term is:

```
Cliquidity(a,t)
=
min(
120 ,
0. 25 + 9 · √(min( 9 , ua))
)
```
If volume is missing, the model applies a floor:

```
Cliquidity(a,t)
=
max(Cliquidity(a,t), 35 )
when dollarvolume a = 0 and Na > 0
```
That missing-liquidity floor is a deliberately conservative modeling choice. If the system does not
know enough about current trading capacity, it does not get to pretend the trade is cheap.

Quote staleness is:

```
Cstale(a,t)
=
0 ,
if quoteage seconds a ≤ 8
min( 20 , (quoteage seconds a - 8 ) / 6 ),
if 8 < quoteage seconds a ≤ 60
min( 80 , 4 + (quoteage seconds a - 60 ) / 10 ),
if quoteage seconds a > 60
```
This cost is separate from volatility. Volatility says the price may move even when the quote is fresh.
Staleness says the observed quote itself may no longer be the price the account can trade.

Gap and session terms are:


```
Cgap(a,t)
=
clamp(
(gapdays to next trading session t - 1 ) · 1. 75 ,
0 ,
25
)
Msession(a,t)
=
sessionmultiplier(
liquiditywindow t,
sidea
)
```
The full one-side cost is:

```
Cside(a,t)
=
(
0. 5 · sa
+ 0. 10 · min( 200 , va)
+ Cliquidity(a,t)
+ Cstale(a,t)
+ Crecent slippage(a,t)
)
* Msession(a,t)
+ Cgap(a,t)
```
The five terms inside the parentheses have different meanings:


```
0. 5 · sa:
expected half-spread cost
0. 10 · min( 200 , va):
near-term volatility markout allowance, capped before multiplication
Cliquidity(a,t):
capacity and partial-fill risk from action size
Cstale(a,t):
price-observation reliability penalty
Crecent slippage(a,t):
feedback from realized fill quality
```
The entry and exit sides are then:

```
Centry(a,t)
=
Cside(a,t) · I(a ∈ {BUY, ROTATE, REPLACE})
Cexit raw(a,t)
=
Cside(a,t) · I(a ∈ {SELL, ROTATE, REPLACE})
+ 0. 85 · Cside(a,t) · I(a ∉ {SELL, ROTATE, REPLACE})
```
For a fresh buy, the model scales the future exit estimate before reserving it:

```
Cexit modeled(a,t)
=
0. 65 · Cexit raw(a,t),
if a = BUY
Cexit raw(a,t),
otherwise
```
The future exit reserve is:

```
Cexit reserved(a,t)
=
Cexit modeled(a,t)
* clamp(exitreserve fraction a, 0 , 1 )
```
The queue-delay term is:


```
Cqueue(a,t)
=
min(
60 ,
0. 8
+ 12 · ua
+ 4. 5 · max( 0 , Msession(a,t) - 1 )
)
* I(a ∈ {BUY, SELL, ROTATE, REPLACE})
```
The cancel/replace mutation term is:

```
Creplace(a,t)
=
min(
60 ,
Capi budget(a,t)
+ Clost queue priority(a,t)
+ max( 0 , Msession(a,t) - 1 )
)
* I(a ∈ {REPLACE, CANCEL} or openorder exists a)
```
The same-ticker reversal-memory term is:


```
hmemory(a,t)
=
predictedholding seconds a,
if predictedholding seconds a > 0
60 · edgehorizon minutes a,
otherwise
wmemory(a,t)
=
exp(
```
- recentopposite fill age seconds a
    / hmemory(a,t)
)
Cmemory(a,t)
=
max(
recentopposite fill cost bps a,
Centry(a,t) + Cexit modeled(a,t)
)
* wmemory(a,t)

This term is active only when the action reverses a recent opposite-side same-ticker fill and the
memory horizon is valid. It is economically different from a cooldown. A cooldown says "do not trade
for a fixed period." This term says "you may reverse, but the reversal must earn back the remaining
relevant cost of the prior trade."

The opportunity value of waiting is:

```
Cwait(a,t)
=
cashwaiting value bps(t)
* I(a ∈ {BUY, ROTATE})
```
This term prevents the system from treating idle cash as worthless. A buy must beat not only trading
friction, but also the value of waiting for a better opportunity. A sell can be attractive when the value
of cash exceeds the expected value of continuing to hold the current exposure.

Now the action-specific cost equations are:


```
Caction(BUY,t)
=
Centry(BUY,t)
+ Cexit reserved(BUY,t)
+ Cqueue(BUY,t)
+ Cmemory(BUY,t)
Caction(ROTATE,t)
=
Centry(ROTATE,t)
+ Cexit modeled(ROTATE,t)
+ Cqueue(ROTATE,t)
+ Cmemory(ROTATE,t)
Caction(SELL,t)
=
Cexit modeled(SELL,t)
+ Cqueue(SELL,t)
+ Cmemory(SELL,t)
Caction(REPLACE,t)
=
Creplace(REPLACE,t)
+ Cqueue(REPLACE,t)
+ Cmemory(REPLACE,t)
Caction(CANCEL,t)
=
Creplace(CANCEL,t)
```
The gross action edge is different for each action type:


```
SBUY(t)
=
Emodel edge(BUY,t)
```
- Cwait(BUY,t)
SROTATE(t)
=
Emodel edge(newtarget,t)
- Emodel edge(oldposition,t)
- Cwait(ROTATE,t)
SSELL(t)
=
cashwaiting value bps(t)
- Emodel edge(currentposition,t)
SREPLACE(t)
=
replacementimprovement bps(t)
SCANCEL(t)
=
replacementimprovement bps(t)

The practical implementation writes this more compactly, but this expanded form shows the
economics. A buy compares a candidate against cash. A rotation compares a new exposure against
the old exposure plus the value of waiting. A sell compares cash against the current holding. A
replacement compares the improvement in an existing order against the cost of mutating that order.
A cancel is valid only when the value of canceling exceeds the cost or opportunity lost by leaving the
order alone.

The final deterministic gateway is:


```
Ha(t)
=
max(
Hmin(a,t),
Caction(a,t) + Coperational(a,t)
)
netaction surplus bps(a,t)
=
Sa(t) - Ha(t)
decision(a,t)
=
tradeor mutate,
if netaction surplus bps(a,t) > 0
and accountconstraints pass(a,t)
and marketstate allows(a,t)
and noduplicate conflicting order(a,t)
holdor wait,
otherwise
```
The Bayesian version substitutes posterior distributions for point estimates:

```
Sa(t) ∣ Dt
∼ posterior predictive edge distribution
Ha(t) ∣ Dt
∼ posterior cost-hurdle distribution
netaction surplus bps(a,t) ∣ Dt
=
Sa(t) - Ha(t)
```
The probability of a genuinely positive action is:

```
Paction positive(a,t)
=
ℙ(
netaction surplus bps(a,t) > 0
| Dt
)
```

The expected surplus is:

```
Eaction surplus(a,t)
=
𝔼[
netaction surplus bps(a,t)
| Dt
]
```
The cautious Bayesian gate is:

```
execute(a,t)
if
Eaction surplus(a,t) > 0
and Paction positive(a,t) ≥ pmin(a,t)
and lowercredible bound(
netaction surplus bps(a,t)
) > - tolerance(a,t)
```
The fast practical gate approximates this by using conservative edge estimates, explicit cost
components, and operational buffers. The reason this approximation is acceptable is that each cost
component is visible, bounded, and testable. If spread estimates are wrong, the spread term can be
inspected. If liquidity is missing, the missing-liquidity floor is visible. If reversals churn too much,
the action-memory cost is visible. If queue effects dominate, the queue-delay term is visible. The gate
is therefore not a black box; it is a decomposed Bayesian decision rule implemented as a fast
deterministic cost oracle.

### 60. Why The Effective Horizon Is 15 Minutes

The configured dynamic-friction edge horizon is stored as 0.0 minutes, but that does not mean the
model tries to capture literally any positive instantaneous edge. In the practical implementation, a
zero explicit dynamic-friction horizon means "derive the horizon from the target execution signal
horizon." The active target execution signal horizon is 0.25 hours:

```
0. 25 hours · 60 minutes/hour = 15 minutes
```
So the effective horizon is 15 minutes.

This should be understood as an after-cost action evaluation window, not as a statement that orders
wait 15 minutes before trading. The model can trade immediately if the order clears the gate. The
horizon says what kind of edge the gate is trying to measure: an executable edge that should survive


the next several 5-minute bars, not a vanishing mark-to-model edge that exists only at the decision
timestamp.

The reason not to use a 0-minute horizon is that a literal instantaneous edge is too fragile. Real
execution contains:

```
price movement between decision and order placement;
spread crossing or limit-order non-fill risk;
quote staleness;
broker acknowledgement delay;
partial fills;
open-order queue effects;
account cash and settlement constraints;
the possibility that waiting a few minutes is more valuable than trading now.
```
The conversion into an after-cost EV hurdle works in three steps.

First, the source signal is translated into a gross executable edge. In the current role-edge version,
that is approximately:

```
grossmodel edge bps(i,t)
=
sourcemember edge bps(i,t)
* dynamicfriction multiplier(rolei)
```
The 0.30 multiplier already prevents the raw source edge from being trusted at full strength.

Second, the execution model builds the cost hurdle:

```
requirededge bps
=
max(
minimumhurdle bps,
entrycost bps
+ reservedfuture exit cost bps
+ queuedelay risk bps
+ actionmemory cost bps
+ operationalrisk bps
)
```
The entry and exit terms include spread, volatility, liquidity/capacity, quote staleness, recent
slippage, session effects, and holiday or overnight gap risk where applicable. The waiting/cash
alternative is subtracted from the gross edge before comparison. For a buy, the practical decision is:


```
trade if:
grossmodel edge bps
```
- cashwaiting value bps
- requirededge bps
> 0

For a sell, the sign reverses: the system asks whether the value of cash or exiting the exposure beats
the holding value after sell friction.

Third, the 15-minute horizon supplies the edge-persistence clock used by the gate. When no more
specific predicted holding time is available, the system passes:

```
predictedholding seconds
=
15 minutes · 60 seconds/minute
```
That clock matters most for reversal and churn control: a recent opposite-side same-ticker fill is not
treated as a permanent ban, but its unrecovered cost decays over the expected edge horizon. In plain
terms, if the system just paid spread and slippage to move into or out of a ticker, the next reversal
must earn back the still-relevant cost unless enough time has passed for that old decision to become
less economically relevant.

If the gate accepted "any positive after-cost EV" at a nearly instantaneous horizon, tiny noisy edges
could be overtraded. The 15-minute horizon gives the signal a short but nonzero window in which it
must remain economically meaningful.

Conceptually:

```
0 - minute edge:
"At this exact instant, before the market moves, is there a tiny positive
mark-to-model edge?"
15 - minute executable edge:
"After realistic near-term price movement, spread, fill risk, and the value
of waiting, is this action still worth taking?"
```
Thus the 15-minute horizon is not mainly a rule that limits the number of trades per day. Trade
frequency falls only indirectly because fewer marginal trades can clear a realistic short-horizon
hurdle. It is also not a substitute for explicit churn-cost estimation: churn is charged directly through
entry cost, reserved exit cost, queue risk, action-memory cost, and operational risk. The horizon is
the time scale that makes those costs comparable to the model edge. It prevents the system from
treating a fragile one-tick advantage as equivalent to an actionable after-cost opportunity, while still
being short enough for a 5-minute intraday target process.


### 61. Dynamic Friction By Regime And Role

The adaptive multiplier surface is already part of the applied model. It starts from the validated
baseline multiplier seeds, then adjusts the effective multiplier as evidence accumulates by role,
regime, ticker, liquidity state, source package, and realized execution quality.

The general form is:

```
effectivemodel edge bps(i,t)
=
sourcemember edge bps(i,t)
* m(rolei, regimet, tickeri, liquidityt, sourcepackage t)
```
where m(.) is the learned multiplier. A stronger regime for a particular source package allows a
higher multiplier. A weaker or noisier regime forces a lower multiplier. A liquid mega-cap with stable
spreads can deserve a different friction multiplier than a fast-moving name with wider spreads. A
ticker that historically realizes the source package's edge cleanly earns more trust than a ticker that
frequently gives back its raw signal to slippage and failed fills.

In Bayesian form:

```
mr,k,p,t
∼ Β-like or logistic-normal posterior
logit(mr,k,p,t)
= η 0
+ ηrole[r]
+ ηticker[k]
+ ηpackage[p]
+ ηliquidity[k,t]
+ ηregime[r,t]
+ ηexecution quality[k,t]
```
The baseline surface corresponds to:

```
η 0 = logit( 0. 30 )
ηrole[primary] = 0
ηrole[secondary] = 0
```
That is the starting point inherited from the validated prior surface. The dynamic model then updates
the multiplier through posterior evidence:


```
multiplier_updater,k,p,t
=
shrink(
realizedafter cost_edger,k,p,t
```
- predictedafter cost_edger,k,p,t,
posteriorsample_sizer,k,p,t,
posterior_variancer,k,p,t
)
effective_multiplieri,t
=
clamp(
baselinemultiplier(rolei)
+ multiplier_updaterole i,ticker i,package i,t,
multiplierfloor,
multiplierceiling
)

The shrinkage term is important. A single good fill does not instantly raise the trust multiplier, and a
single ugly fill does not permanently demote a ticker. The update grows only when repeated resolved
actions show that the baseline discount is systematically too strict or too permissive for the current
context.

Behaviorally, the adaptive multiplier gives the gate a memory of how cleanly the source edge is being
realized. If a primary-role source member repeatedly clears spread, fills cleanly, and continues
moving in the expected direction during a healthy liquidity regime, the multiplier can rise above the
0.30 seed and the system becomes more willing to fund that target. If the same role begins losing
edge to widened spreads, stale quotes, failed fills, or adverse reversal, the multiplier falls and the gate
requires a stronger nominal signal before trading.

The result is not an unbounded aggressiveness switch. The multiplier remains inside explicit floors
and ceilings, and it still feeds the same after-cost gateway. Dynamic friction can make a good regime
more tradeable, but it cannot turn a negative after-cost action into a valid trade.

### 62. Order State, Queue State, And Reconciliation

A trading algorithm that ignores order state is not a practical algorithm. The model has to know
whether an action is new, already represented by a working order, partially filled, stale, blocked by
account state, or made irrelevant by a newer target.

Let Ot represent open orders. A target delta is not immediately converted to another order if the same
exposure is already being pursued. The gate must compare:


```
desired_δt
vs
workingorder_δt
vs
filled_δt
vs
brokerposition_δt
```
The order-state penalty can be written as:

```
orderstate penalty bps
=
duplicateorder penalty
+ staleorder penalty
+ partialfill uncertainty
+ cancelreplace cost
+ brokerstate uncertainty
```
This is one reason replay realism matters. A strategy can look excellent if each replay row is allowed
to trade frictionlessly with perfect immediate fills. It can fail when orders queue, prices move,
spreads widen, or a position is already in transition.

The active replay methodology uses practical reconciliation proxies, open order carryover, and order
queue limits to make the historical simulation more like realistic trading. This matters for
deployability because a practical implementation does not trade an isolated mathematical target. It
trades accounts through a broker.

### 63. Prospective Shadow Evaluation Monitor

The current applied implementation keeps the validated baseline trading surface active while adding
a background shadow evaluation monitor. This is the bridge between research and promotion
readiness.

The monitor compares:

```
baseline:
validated provenance-membership action gate
challenger:
adaptive action-value selector
```

The baseline is the current practical-safe surface. The challenger is a more adaptive surface selector
that needs causal evidence before it can replace the baseline.

The promotion monitor uses a prior and clean prospective shadow samples:

```
δpost
=
(κ 0 · δ 0 + nclean · mean(δshadow clean))
/ (κ 0 + nclean)
```
where:

```
δ 0 is the prior delta.
κ 0 is prior strength.
nclean is the number of clean resolved prospective shadow observations.
δshadow clean is the clean realized challenger-minus-baseline value.
```
The current monitor settings are:

```
prior_δ: 0
priorstrength: 7
minimumclean resolved rows: 30
minimumpositive share: 55 percent
minimumposterior_δ: 0
automaticsurface switching: disabled
```
These monitor values intentionally favor delayed confidence over automatic reaction. A prior
strength of 7 is strong enough that a tiny number of prospective shadow observations cannot
immediately overrule the validated baseline, but small enough that a stream of clean observations
can move the posterior. A minimum of 30 clean resolved rows gives the challenger enough
observations to be more than a handful of anecdotes. The 55 percent positive-share hurdle requires
the challenger to win more often than it loses, while the posterior delta condition requires the
average win/loss magnitude to be positive. Disabled automatic surface switching keeps the monitor
as evidence generation, not unattended replacement.

The positive-share condition is:

```
positiveshare
=
count(δshadow clean > 0 ) / nclean
```
Promotion requires:


```
nclean ≥ 30
positiveshare ≥ 0. 55
δpost > 0
blockingdata quality issues = false
```
With automatic surface switching disabled, even a qualifying challenger is made promotion-ready
rather than silently replacing the baseline surface. That is the correct posture for a practical financial
implementation. The background process can collect evidence and identify readiness, but a
promotion step still needs to respect auditability and operational intent.

The crucial methodological improvement is causal evidence. A curve-level replay can say, "This
selector would have looked good on this historical slice." A prospective shadow monitor can say, "At
the time the baseline made its decision, the challenger also made a decision under the same
information constraints, and we later observed which one was better." The second claim is far
stronger.

### 64. Dynamic Action Surface Challenger

The dynamic action surface challenger tries to estimate action value at a more granular level than the
static provenance membership signal. It asks whether a particular ticker, source package, provenance
role, session bucket, target weight, and account context should receive more or less executable edge.

The research form is:

```
dynamicsource action value bps(t, ticker)
=
shrink(
bucketprior bps(provenance, sourcepackage, sessionbucket)
+ opportunityarrival credit bps(t)
+ targetweight confidence bps(ticker,t)
```
- cashwait value bps(t)
- currentholding opportunity cost bps(ticker,t),
toward = staticfallback bps,
strength = samplecount / (samplecount + priorstrength)
)

The implementation also tracks context features:


```
contextfeatures =
(
targetweight,
scaledsource prediction,
sourceprediction available,
currentweight,
δweight,
cashfraction
)
```
Within each bucket, it can learn a ridge adjustment:

```
βbucket
=
(Xbucket' Xbucket + λ I)-^1
Xbucket' ybucket
adjustmentbucket
=
(xcurrent - meanx bucket)′ βbucket
```
The shrinkage estimate becomes:

```
actionvalue hat
=
(priorstrength · fallbackbps
+ samplecount · (bucketmean bps + adjustmentbucket))
/ (priorstrength + samplecount)
```
This is a more refined approximation than the static membership signal because it can learn that the
same source package role is more valuable in some contexts than in others. But refinement also
increases overfit risk. A high-CAGR short-window candidate is diagnostic, not promotion evidence. It
becomes promotion evidence only after it is tested across the full window with deployability
constraints or matured through prospective shadow outcomes.

This is why the current applied model is structured as a monitor rather than a silent replacement.
The practical implementation is allowed to learn, but the trading gate stays on the validated surface
until the challenger has clean causal evidence.


### 65. Full Action Value Equation

The most complete applied action equation is:

```
Q(a, t)
=
𝔼[
Δ Wt:t+h
| It, a
]
```
- Cexec(a,t)
- Cspread(a,t)
- Cslippage(a,t)
- Cimpact(a,t)
- Cpartial(a,t)
- Cmissed(a,t)
- Cqueue(a,t)
- Cstale(a,t)
- Crisk(a,t)
- Copportunity(a,t)
+ Rrepair(a,t)

The chosen action is:

```
a*t = arg maxa in A t Q(a,t)
```
subject to:

```
cashafter action ≥ minimumcash
positionweight i ≤ hardaccount or strategy limit i, when such a limit exists
ordercount rate ≤ brokerand system capacity
noduplicate conflicting working order
freshnesschecks pass
authorizationand account state valid
```
The target action is executable only if:


```
Q(targetrotation action,t)
>
max(
Q(holdcurrent positions,t),
Q(wait,t),
Q(stayin cash,t),
Q(repairaccount state,t),
Q(alternaterotation,t)
)
```
This equation is the applied version of the original theory. It is also the reason the system can
recommend no trade even when the model likes a ticker. The system is not paid for liking a ticker. It
is paid for making the account better after all costs and alternatives.

##### Cash-Only Budget Constraint

The applied model assumes every buy is funded from cash already available in the account or from
sell proceeds released by the same feasible rotation package. The target model can rank a security as
attractive, but the execution gateway can only act if the complete package leaves the account above its
cash floor after estimated spread, slippage, rounding, settlement, and repair reserves.

This cash-only rule is a feasibility constraint, not an alpha signal. It does not change which security is
expected to have the best return. It only decides how much of an already approved action can be
placed now without creating a cash shortfall.

The practical approximation is:

```
cashtrade budget t
=
max( 0 , casht - cashfloor t)
sellfunded cash t(a)
=
sum over eligible sell legs j in action package a of
max( 0 , expectedsell_proceedsj,t - reservedsell_costj,t)
availablebuy budget t(a)
=
cashtrade budget t + sellfunded cash t(a)
```
A buy leg is feasible only if:


```
buynotional t(a) + estimatedbuy cost t(a)
≤ availablebuy budget t(a)
```
After the full package:

```
cashafter action t(a) ≥ cashfloor t
```
This distinction matters because the executor evaluates a rotation as a package, not as isolated buy
legs. If the account begins with little free cash, a sell-funded rotation can still be feasible when the sell
side is executable, the buy side has positive after-cost value, and the complete package respects the
cash floor. Conversely, a high-scoring target is delayed when the package cannot satisfy the floor after
costs, even if the alpha model likes the ticker.

The action value therefore remains:

```
Qcash feasible action(a,t)
=
Qtarget and signal(a,t)
```
- 𝔼[spreadcost(a,t)]
- 𝔼[slippagecost(a,t)]
- 𝔼[roundingcost(a,t)]
- 𝔼[settlementdelay cost(a,t)]
- 𝔼[cashshortfall penalty(a,t)]

The final gate compares this feasible-action value against holding, waiting, repairing account state,
and alternate rotations. Cash is repaired only when repair has better expected after-cost value than
holding, waiting, or completing the target rotation.

### 66. Behavioral Walkthrough Of A Trading Cycle

A single trading cycle behaves approximately as follows.

First, the system refreshes observations. It checks market data, account balances, positions, open
orders, authorization state, and feature freshness. If critical state is stale or invalid, the correct action
may be repair, wait, or avoid real orders.

Second, the source package selector decides which source package currently has authority. It uses
prediction-sign regime evidence, not just a raw ticker rank. This matters because the system is
selecting a learned decision surface, not merely sorting stocks by a universal score.

Third, the selected source package emits candidates. The target gateway filters the compact source
slate to the currently tradable, evidence-qualified members, then uses source-conviction weighting to
allocate desired exposure. It does not force a fixed position cap or a fixed number of holdings; a


single ticker can receive most of the target book when its after-cost opportunity dominates. A ticker
can enter as a primary source member, secondary source member, retained baseline member, or
non-member.

Fourth, the provenance membership signal assigns role edge. A primary target receives 460 bps
nominal source edge. A secondary target receives 348 bps. A retained baseline position receives 200
bps. These values are then discounted by the adaptive dynamic-friction multiplier, which starts from
the validated 0.30 baseline seed and moves with regime, liquidity, ticker, and execution quality
evidence.

Fifth, the execution gate evaluates each required action. If the portfolio needs to sell an old name to
fund a better target, the system evaluates the rotation as a sell-funded action, not as a cash-only buy.
If a buy edge is too small relative to spread, slippage, queue risk, and wait value, the system holds or
waits. If a sell repairs a stale or unwanted exposure, it can pass even when a simple buy-style
equation would not.

Sixth, orders are routed only if the account and order state allow them. Open orders and partial fills
affect the next cycle. The system avoids treating broker state as if it were instantly synchronized with
model state.

Seventh, outcomes are recorded. Prospective shadow monitor rows mature when the system can
resolve what happened after the action window. These rows are used to judge whether a challenger
surface deserves promotion.

For a lay user, the behavior can be summarized this way:

```
The system repeatedly asks:
1. Which strategy source is working best right now?
2. Which stocks would that source want to own?
3. Is moving toward those stocks worth the real cost of trading?
4. Are there account or brokerage issues that make waiting safer?
5. Did the decision later prove better than the alternative?
```
That last question is what lets the practical implementation learn without pretending that every
backtest curve is promotion evidence.

### 67. Interpretation Of Current Performance Metrics

The current active model is deployable and has a very high historical cash-option-adjusted
annualized return in the replay evidence. The important interpretation is not merely "CAGR is high."
The important interpretation is:

```
The strategy preserved a high-return source-selector surface
while adding stricter execution realism and prospective shadow evidence collection.
```

Notable operational metrics include:

```
target cadence: 5 minutes
source sessions tested: 181
dynamic friction all-leg pass rate: about 42 percent
partial package rate: about 58 percent
average dynamic-friction executable orders/year: about 1 , 955
average dynamic-friction held orders/year: about 519
average trades/year: about 9 , 234
average turnover/year: about 109 x
average annual cost drag: about 47. 6 percent
```
These metrics reveal both strength and risk.

The strength is that the strategy can still produce high replay returns after substantial trading-cost
realism. The dynamic friction gate is actively holding many potential orders, and the multiplier
surface can become stricter or more permissive as realized execution quality changes. That means the
validated surface is not simply firing on every target delta.

The risk is that turnover and cost drag remain high. A high-CAGR strategy can still be fragile if too
much of its edge depends on perfect order behavior, stable spreads, or repeated intraday rotations.
This is why the promotion monitor, action audit rows, and dynamic multiplier calibration telemetry
are not optional extras. They are how the system protects itself from mistaking simulated
opportunity for practically executable profit.

### 68. Where The Applied Model Deviates From The Ideal

The ideal model in the original theory is a fully unified Bayesian stochastic control system. The
current applied model is an approximation. The deviations are deliberate.

First, the practical implementation does not yet solve a full joint posterior over every feature,
covariance component, source package, order-state variable, and action outcome during every
trading cycle. That would be computationally expensive and operationally fragile.

Second, the Bayesian factor posterior is currently research and selection support, not the sole
practical trading authority. This avoids promoting an elegant posterior that has not yet proven full-
window deployability.

Third, the current action signal uses static role-edge priors plus an adaptive dynamic-friction
multiplier surface, rather than a fully learned action-value posterior for every ticker and context. This
is less expressive than the theoretical ideal, but more stable.

Fourth, automatic surface switching is disabled. That means the system can identify a promotion-
ready challenger, but it does not silently replace practical trading logic without an explicit promotion
action.


Fifth, the covariance model is conceptually specified more deeply than it is fully exploited in the
current practical target gateway. The theory wants a rich hierarchical covariance model. The applied
strategy currently relies more on source package selection, source-conviction allocation, and
execution gating than on a fully joint portfolio optimizer.

These deviations should not be read as failures. They are engineering tradeoffs. A practical trading
implementation benefits from explicit approximation boundaries because each approximation can be
tested, replaced, and promoted without rewriting the entire system.

### 69. Overfit Risk And Generalization

Any high-return selector is at risk of overfit. A short-window threshold challenger can look
exceptional because it found a narrow historical pocket. The question is not whether the result is
interesting. It is whether the result generalizes.

The applied anti-overfit rules are:

```
1. A short high-CAGR gap-window row is diagnostic only.
2. Full-window zero-missing and zero-unresolved evidence is required for
promotion-grade replay proof.
3. Prospective shadow outcomes are stronger than curve-level hindsight.
4. Action-level rows must be resolved under the same information constraints
the practical executor would have had.
5. Dynamic-action challengers need enough clean samples before they can replace
static provenance membership.
```
Generalization can be improved by replacing brittle thresholds with posterior surfaces:

```
hard rule:
use challenger if window = 7 and threshold = 0. 08
generalized rule:
ℙ(challenger better than baseline ∣ clean shadow evidence, regime, context)
must exceed a promotion standard
```
The generalized Bayesian selector is:


```
Δc,b,t
=
valuechallenger t - valuebaseline t
Δc,b,t ∣ θ, xt
∼ 𝒩(xt' θ, σ_δ^2 )
θ ∼ 𝒩(θ 0 , V 0 )
```
Promotion should depend on:

```
ℙ(𝔼[Δc,b ∣ current practical distribution] > 0 ∣ data)
```
rather than on a single historical threshold. This is exactly the spirit of Bayesian shrinkage from the
2021 paper: use structure and posterior uncertainty to avoid overbelieving a narrow historical fit.

### 70. User-Facing Behavior Without Implementation Jargon

Although the algorithm is mathematically dense, the behavior it produces can be explained without
jargon.

The system watches the market and asks which of its learned strategies is currently most trustworthy.
It then forms a preferred target portfolio from the names with enough current evidence. That
portfolio can be concentrated, and it can contain fewer names than the original candidate slate. The
system does not automatically buy every preferred stock. Instead, it checks whether the trade is still
worth making after the practical costs of entering and eventually leaving the position.

If the model likes a stock but the spread is too wide, the system may wait. If the model wants a new
stock but the account is already holding another stock that no longer belongs, the system may sell the
old one first and use the proceeds. If the account already has an open order pursuing the target, the
system avoids blindly duplicating the order. If the model's evidence is stale, the system should prefer
waiting or repair over action.

So the system's visible trading personality is:

```
opportunistic when the source package has strong evidence;
skeptical when the trade would lose too much to friction;
willing to hold cash when no trade clears the hurdle;
willing to rotate when selling funds a better target;
cautious about promoting new research until it has causal evidence.
```
This behavior is the practical translation of Bayesian control. The system does not need certainty. It
needs enough posterior expected value to justify the action after costs.


### 71. Scientific Uses Beyond Trading

The same Bayesian architecture can apply outside finance whenever decisions must be made under
noisy, mixed-frequency evidence.

Meteorology is a natural example. Weather systems combine satellite imagery, radar, ground
stations, numerical models, pressure fields, ocean temperatures, and local observations. These
sources arrive at different frequencies and have different reliability by regime. A Bayesian grouped
selector could learn which model family deserves more weight in a hurricane, a winter storm, a
convective thunderstorm regime, or a local fog regime. The action might be issuing a warning,
rerouting flights, or changing grid preparation status.

Epidemiology is another example. A disease surveillance system receives test positivity, wastewater
measurements, hospital admissions, mobility data, school-absence data, genomic variant signals, and
clinical reports. These are mixed-frequency, lagged, and noisy. A grouped Bayesian model can shrink
weak signals, elevate reliable clusters, and produce posterior probabilities for intervention
thresholds.

Energy-grid management has the same structure. Grid operators forecast demand, renewable
generation, equipment stress, weather, market prices, and outage risk. A Bayesian action gate can
decide whether to dispatch reserves, buy power, delay maintenance, or shed flexible load. The
equivalent of trading friction is startup cost, ramp constraint, reliability risk, and opportunity cost.

Medical triage also fits. A hospital can combine vitals, labs, imaging, physician notes, medication
history, and unit capacity. The Bayesian posterior does not need to be perfectly certain. It needs to
decide whether the expected benefit of an action, such as escalation, imaging, discharge, or
observation, exceeds its cost and risk.

Industrial reliability is another close cousin. Sensors on machines produce high-frequency vibration,
temperature, acoustic, and pressure data. Maintenance logs and production schedules arrive at lower
frequency. A grouped Bayesian system can decide whether to keep running, inspect, slow down, or
shut down before failure. The dynamic friction equivalent is downtime cost, false alarm cost, and
failure severity.

In all these settings, the abstract structure is:

```
1. Many noisy signals arrive at different times.
2. Signals are grouped and correlated.
3. The system maintains posterior beliefs.
4. Actions have costs, delays, and opportunity costs.
5. The best decision is not the highest raw score.
6. The best decision is the action with the highest posterior after-cost value.
```
That is the broad scientific contribution of the applied approach.


### 72. Computational Tractability And Complexity Proof

The original theoretical optimum is intentionally broad. If interpreted literally, it can look like a
dense pairwise control problem: every security can replace every other security, every action can
interact with every other action, and every covariance term can matter. That naive reading is valuable
for defining the economic objective, but it is not how the applied system computes decisions.

Define the main dimensions:

```
n:
number of securities in the observable universe
p:
number of active standardized indicators per security
G:
number of feature groups
dg:
number of indicators in group g
H:
number of prediction horizons
k:
number of low-rank risk factors
m:
number of securities surviving the evidence-qualified candidate slate
q:
number of executable legs in an action package
T:
number of decision timestamps in a replay or practical run
B:
number of walk-forward validation windows or self-test folds
```
##### Approximation Concessions

The applied model is an approximation because the exact theoretical object is too large to compute at
the intended cadence. The concessions are deliberate and bounded:

1. The implementation does not resample a full joint posterior over every
    feature, ticker, covariance edge, account state, and action at every decision
    timestamp. It precomputes and caches sufficient statistics by feature group.


2. It does not materialize every possible pairwise rotation before learning
    which securities deserve attention. It scores the universe once, prunes to an
    evidence-qualified slate, and then expands only feasible action packages.
3. It does not invert a dense n x n covariance matrix on each cycle. It uses a
    low-rank factor term, diagonal idiosyncratic risk, and bounded sparse residual
    links.
4. It does not numerically integrate a full posterior predictive distribution
    for every candidate order at the final gate. It uses a deterministic
    after-cost oracle whose inputs are posterior means, uncertainty discounts,
    role priors, dynamic friction multipliers, and explicit execution costs.
5. It does not treat every horizon as an unbounded dimension. The horizon set is
fixed by the validated decision cadence, so H is bounded rather than
growing with the universe.
6. It does not prove global optimality over every mathematically possible
    portfolio. It proves causal equivalence between the written practical
    specification and the replayed implementation, then asks whether that
    approximation beats alternatives after costs.

Those concessions are the difference between a beautiful but unusable stochastic control problem
and a practical implementation. The approximation keeps the economic comparison that matters:
buy, sell, rotate, wait, or repair only when that action beats its alternatives after cost and uncertainty.
What it gives up is exhaustive enumeration of every action and every covariance edge at every
timestamp.

A naive all-pairs rotation surface has:

```
Apair(t)
=
{ ROTATE(i → j): i in Ut, j in Ut, i ≠ j }
|Apair(t)|
=
Θ(n^2 )
```
If dense covariance is recomputed and inverted directly, the naive risk step can be even more
expensive:


```
Σt in Rn^ x^ n
dense covariance storage:
Θ(n^2 )
dense quadratic solve:
O(n^3 )
naive action replay:
Θ(T n^2 )
```
For a full walk-forward evaluation, the theoretical dense envelope is:

```
Ctheory dense(B,T,n,p,H)
=
O(
B T
(
n p H
+ n^2 H
+ n^3
)
)
```
If p and H are bounded but the dense covariance solve remains inside the decision loop, then:

```
Ctheory dense(B,T,n)
=
Θ(B T n^3 )
```
If the dense covariance solve is omitted or precomputed but every pairwise rotation is still evaluated,
the theoretical pairwise envelope is:

```
Ctheory pairwise(B,T,n)
=
Θ(B T n^2 )
```
The storage requirement for the literal dense theoretical object is:


```
Stheory(n,p)
=
Θ(n p)
+ Θ(n^2 )
+ Θ(|Apair(t)|)
=
Θ(n^2 )
```
So the theoretical model has two different bottlenecks. With dense covariance optimization, time is
cubic in n. Without dense covariance optimization, the all-pairs action surface is still quadratic in n.
In either case, the exact literal object is not suitable for frequent practical evaluation as n grows.

That is the wrong computational object for a practical decision system. The applied system uses the
theory to define the objective, then uses factorization, caching, candidate pruning, and cost-oracle
evaluation to compute a close, implementation-ready approximation.

Figure 7 summarizes the computational move. The theoretical objective still knows that actions
compete with alternatives and that correlations matter. The implementation does not enumerate
every pair first. It updates feature and group summaries, uses low-rank risk, prunes to a compact
candidate slate, and then evaluates only the feasible action packages.


```
Efficient Bayesian Computation Path
The model keeps the Bayesian objective rich while avoiding dense all-pairs computation.
```
```
Naive Interpretation
```
```
All Securities Against All Securities
ROTATE(i - > j) for every i,j
Theta(n^ 2 ) actions
```
```
Dense Covariance And Portfolio Solve
storage STighmetaa^ (inn^ ^R 2 ^){, ns^ oxl^ vne} O(n^ 3 )
```
```
Replay Every Pair At Every Time
C_naive(B,T,n) = Theta(B T n^ 2 )
```
```
Problem
to mistake correlated signals for evidencetoo slow, too redundant, and too easy
```
```
Applied Efficient Path
```
**1. Stream Features Once**
    O(n p_active)
**2. Update Group Sufficient Statistics**
O(sum_g d_g^ 2 ), bounded by design
**3. Compute Low-Rank Risk**
O(n k + k^ 2 + nnz(S))
**4. Prune To Top Candidate Slate**
O(n log m), m << n
**5. Gate Only Compact Action Packages**
O(m q), bounded by action design
C_applied(B,T,n) = Theta(B T n)
and C_applied = o(B T n^ 2 )

```
Efficiency comes from the graph structure: feature groups and candidates are pruned before action expansion.
```
```
Figure 7. Efficient Bayesian computation path.
```
##### Streaming Feature Construction

Each source observation is transformed into standardized indicators before it can enter the model.
The raw sources are:


```
market bars:
open, high, low, close, volume, intraday returns, gaps
quotes and microstructure:
bid, ask, midpoint, spread, quote age, dollar volume, order state
technical analysis:
trend, relative strength, breakout, support, extension, oversold,
volatility, ATR, volume shock, intraday torque
fundamental analysis:
quality, earnings-growth style inputs, relative-strength style inputs,
liquidity quality, slow-moving company-quality descriptors
event and semantic context:
company-specific catalyst evidence, sector stabilization, relative conviction
portfolio state:
current weight, target δ, drift, open orders, recent fills
calendar and session state:
regular session bucket, holiday or shortened-session state, gap to next
trading session
```
For indicator j on security i at time t:

```
zj,i,t
=
(xj,i,t - μj,t-) / max(sj,t-, sfloor j)
```
where μj,t- and sj,t- are known before time t. This causal standardization prevents a future observation
from changing a past score.

With sparse source updates, the feature cost is:

```
Cfeature(t)
=
Θ(nnz(Xt))
≤
Θ(n p)
```
where nnz(Xt) is the number of non-missing active feature entries at time t. Because each observable
security must be inspected at least once, the lower bound is:


```
Cfeature(t)
=
Ω(n)
```
So the efficient target is not sublinear in the universe. The efficient target is linear or near-linear,
rather than pairwise quadratic.

##### Grouped Bayesian Update Cost

The grouped Bayesian model does not need to resample a full posterior over all features on every
practical cycle. It maintains sufficient statistics by group:

```
Ag,t
=
Xg,t' Wt Xg,t
+ Λg,t
bg,t
=
Xg,t' Wt yt
mg,t
=
Ag,t-^1 bg,t
Vg,t
=
σt^2 Ag,t-^1
```
The posterior predictive contribution for a new row is:

```
𝔼[yi,t,h ∣ Dt-, Xi,t]
=
αh,t
+ ∑g= 1 G Xi,t,g mg,h,t
+ Zi,t δh,t
```
For one new weighted observation, a rank-one sufficient-statistic update costs:

```
Cupdate g
=
O(dg^2 )
```

An occasional exact group refit costs:

```
Crefit g
=
O(dg^3 )
```
but this is not paid for every security on every practical decision. The practical scoring cost after the
summaries exist is:

```
Cscore(t)
=
Θ(n pactive)
```
where pactive is the number of active scoring indicators. If group sizes are bounded by design, then:

```
maxg dg ≤ dmax
∑g= 1 G O(dg^2 )
≤
O(G dmax^2 )
```
When G, dmax, and pactive are bounded relative to n, posterior maintenance plus scoring is:

```
Cbayes tick(t)
=
O(G dmax^2 + n pactive)
=
Θ(n)
```
This is the computational value of the 2021 Bayesian grouped-shrinkage idea in an applied trading
system. The model borrows strength across related signals without forcing the practical process to
solve one dense global regression every few minutes.

This is the first major concession. The Bayesian posterior exists conceptually as a joint distribution
over many feature coefficients, but the applied model computes row scores from cached group
summaries. The approximation replaces:

```
sample full posterior over p features for every timestamp
```
with:


```
maintain grouped sufficient statistics
score each security against bounded active summaries
```
The computational result is:

```
Cfull feature posterior(t)
=
O(p^3 )
or worse when coupled to ticker and action state
Cgrouped practical(t)
=
O(G dmax^2 + n pactive)
=
Θ(n)
```
under bounded group size and bounded active features. The concession is that the practical
implementation does not perfectly preserve every posterior covariance between every feature. The
retained information is the part that is useful for real-time action value: group reliability, posterior
mean, uncertainty, and causal contribution to after-cost edge.

##### Low-Rank Risk Computation

The theoretical covariance object can be dense:

```
Σt in Rn^ x^ n
```
The applied approximation is factorized:

```
Σt
=
Bt Ft Bt'
+ Dt
+ St
```
where Bt is an n x k factor-loading matrix, Ft is a k x k factor covariance matrix, Dt is diagonal
idiosyncratic variance, and St is a sparse residual dependency matrix. Portfolio risk is computed as:


```
wt' Σt wt
=
(Bt' wt)′ Ft (Bt' wt)
+ ∑i= 1 n Di,t wi,t^2
+ wt' St wt
```
The cost is:

```
Crisk(t)
=
O(n k + k^2 + nnz(St))
```
If k is small and each security has only a bounded number of sparse residual links, then:

```
Crisk(t)
=
Θ(n)
=
o(n^2 )
```
This is the practical difference between "modeling correlation" and "paying for every pairwise
correlation every time." The system keeps the economically important dependence structure while
avoiding dense all-pairs enumeration.

This is the second major concession. The theory would allow every security to co-move with every
other security. The practical implementation keeps common factor risk, diagonal idiosyncratic risk,
and only sparse residual links that survive evidence screens. If the number of residual links per
security is bounded by s, then:

```
nnz(St)
≤
s n
Crisk(t)
=
O(n k + k^2 + s n)
=
Θ(n)
```

for bounded k and s. The model is not pretending correlation is absent. It is refusing to pay Θ(n^2 )
storage and O(n^3 ) dense optimization cost for weak residual edges that do not change the feasible
action decision enough to justify their compute burden.

##### Candidate Pruning Before Action Expansion

The most important computational move is that the system does not expand all possible rotations
before ranking candidates. It first computes a causal after-cost score proxy:

```
proxy_edgei,t,h
=
𝔼[yi,t,h ∣ Dt-, Xi,t]
```
- preliminarycost_floori,t
- uncertainty_discounti,t,h

Then it selects a compact candidate slate:

```
Mt
=
topm(
{ i in Ut: proxy_edgei,t,h clears eligibility floor }
)
|Mt|
=
m
<<
n
```
The ranking cost can be implemented as:

```
Crank(t)
=
O(n log m)
```
with a bounded heap, or:

```
Crank(t)
=
O(n)
```

with a linear-time selection procedure followed by sorting only the retained slate. The expensive
action gateway is applied only after this pruning:

```
At
=
feasibleactions(Mt, currentpositions t, openorders t)
|At|
=
O(m q)
```
Each gateway evaluation is a cached cost-oracle call:

```
Q(a,t)
=
𝔼[Δ Wt:t+h ∣ It, a]
```
- Caction(a,t)
- Coperational(a,t)

so:

```
Cgate(t)
=
Θ(|At|)
=
O(m q)
```
When m and q are bounded by the candidate-slate and account-action design, the gateway is
constant-time relative to the full universe.

This is the third major concession. The applied model does not ask:

```
For every current holding i and every security j,
is ROTATE(i → j) optimal?
```
It asks:

```
Which securities survive a causal after-cost eligibility screen?
Which feasible account actions can be built from that compact slate?
```
If m is bounded by design, action expansion is O( 1 ) relative to n. If m is allowed to grow slowly, for
example m = n^α with 0 < α < 1 , then:


```
Cgate(t)
=
O(n^α q)
=
o(n)
```
relative to the universe scan, and still:

```
Crank(t) + Cgate(t)
=
o(n^2 )
```
relative to pairwise action enumeration. The concession is that a security discarded by the first-stage
screen cannot re-enter through a later pairwise rotation comparison during that same cycle. The self-
testing loop is what makes that concession acceptable: it verifies whether the pruning rule still
preserves after-cost performance across the full causal replay window.

##### Complexity Theorem

Assume:

```
1. pactive, H, G, dmax, k, m, and q are bounded by model design.
2. Sparse residual risk links per security are bounded.
3. Candidate pruning happens before pairwise action expansion.
4. Quotes, features, posterior summaries, costs, and account state are cached
once per timestamp.
5. Replay uses the same causal state transition as practical evaluation.
```
Then one decision timestamp costs:

```
Capplied(t)
=
O(
n pactive
+ G dmax^2
+ n k
+ n log m
+ m q
)
```
Under the bounded-design assumptions:


```
Capplied(t)
=
Θ(n)
```
A walk-forward self-test over B folds and T timestamps costs:

```
Capplied(B,T,n)
=
O(
B T
(
n pactive
+ G dmax^2
+ n k
+ n log m
+ m q
)
)
```
and, under the same bounded-design assumptions:

```
Capplied(B,T,n)
=
Θ(B T n)
```
The naive all-pairs replay cost is:

```
Cnaive(B,T,n)
=
Θ(B T n^2 )
```
Therefore:


```
Capplied(B,T,n) / Cnaive(B,T,n)
≤
c / n
limn → infinity
Capplied(B,T,n) / Cnaive(B,T,n)
=
0
Capplied(B,T,n)
=
o(B T n^2 )
```
This is the formal reason the applied model is valuable. The theoretical objective is rich enough to
account for alternatives, covariance, execution, and opportunity cost, but the implemented
computation is linear or near-linear in the number of observable securities.

In Big-O, Theta, and little-o notation, the computational requirements can be summarized
compactly:


```
theoretical dense model:
Ctheory dense(B,T,n) = Θ(B T n^3 )
Stheory dense(n) = Θ(n^2 )
theoretical pairwise model without dense solve:
Ctheory pairwise(B,T,n) = Θ(B T n^2 )
Stheory pairwise(n) = Θ(n^2 )
applied practical model:
Capplied(B,T,n)
=
O(
B T
(
n pactive
+ G dmax^2
+ n k
+ n log m
+ m q
)
)
Capplied(B,T,n)
=
Θ(B T n)
under bounded design dimensions
Sapplied(n)
=
O(n pactive + n k + n + m q + eventst)
```
Therefore:

```
Capplied(B,T,n)
=
o(Ctheory pairwise(B,T,n))
Capplied(B,T,n)
=
o(Ctheory dense(B,T,n))
```
and, more explicitly:


```
limn → infinity
Capplied(B,T,n) / Ctheory pairwise(B,T,n)
=
0
limn → infinity
Capplied(B,T,n) / Ctheory dense(B,T,n)
=
0
```
The proof is not a proof that the practical implementation is globally optimal in the mathematical
universe of all portfolios. It is a proof that the applied algorithm has reduced the computational
object from quadratic or cubic growth to linear growth under explicit bounded-design assumptions.
The remaining burden is empirical and causal: the replay and shadow evidence must show that the
concessions did not remove the actions that actually mattered.

### 73. Source Indicators And Contribution Accounting

The applied signal is not a fixed list of static percentages. An indicator's importance changes by
ticker, horizon, regime, and current execution state. The correct contribution report is therefore local
and posterior-weighted.

For indicator j, security i, time t, and horizon h:

```
indicator_contributionj,i,t,h
=
𝔼[βj,h ∣ Dt-]
* zj,i,t
```
Its uncertainty-discounted contribution is:

```
discounted_contributionj,i,t,h
=
indicator_contributionj,i,t,h
```
- ρh
    * √(Var(βj,h ∣ Dt-))
    * |zj,i,t|

The signed share of the final pre-cost signal is:


```
signed_sharej,i,t,h
=
indicator_contributionj,i,t,h
/
max(
ε,
∑l= 1 p |indicator_contributionl,i,t,h|
)
```
The absolute share is:

```
abs_sharej,i,t,h
=
|indicator_contributionj,i,t,h|
/
max(
ε,
∑l= 1 p |indicator_contributionl,i,t,h|
)
```
For a feature family g:

```
familyabs_shareg,i,t,h
=
sumj in g |indicator_contributionj,i,t,h|
/
max(
ε,
∑l= 1 p |indicator_contributionl,i,t,h|
)
```
These equations are what a user-facing explanation should summarize. If a ticker is selected because
trend, source membership, and liquidity all agree, their family shares will be high. If the ticker is
blocked because spread, quote age, and volatility costs overwhelm the raw edge, the gateway-cost
shares will dominate the after-cost explanation.

The final after-cost score can be decomposed as:


```
precost_edgei,t,h
=
αh,t
+ ∑j= 1 p indicator_contributionj,i,t,h
+ sourcerole_edgei,t,h
+ regime_adjustmenti,t,h
aftercost_edgei,t,h
=
precost_edgei,t,h
```
- execution_costi,t
- uncertainty_discounti,t,h
- waitvalue_hurdlei,t

So contribution can be reported at three levels:

```
1. raw α contribution:
which indicators made the name attractive
2. discount contribution:
which uncertainty or regime terms reduced confidence
3. gateway contribution:
which execution costs converted a target into a trade, wait, or reject
```
The source families are:

```
Source Family Examples Signal Role Efficient
Computation
```
```
Contribution
Summary
Technical trend and
momentum
```
```
short-horizon return
slope, relative
strength, breakout,
upside torque, green-
probability style
features
```
```
Directional alpha; asks
whether price action
supports owning the
security now
```
```
Rolling windows and
causal deltas, Theta(n
H) when horizons are
bounded
```
```
sum_{j in trend}
abs_share_{j,i,t,h}
explains how much of
the pre-cost edge
came from trend-like
TA
Technical chart
structure
```
```
support defense,
extension,
retracement, oversold
state, local structure
alignment
```
```
Detects whether the
current price is near a
historically meaningful
inflection or
continuation zone
```
```
Bounded lookback
transforms, Theta(n
L) with fixed
lookback L
```
```
family_abs_share_{ch
art,i,t,h} rises
when chart structure
reinforces the target
rather than merely
confirming a broad
trend
```

```
Source Family Examples Signal Role Efficient
Computation
```
```
Contribution
Summary
```
Volatility and ATR
state

```
realized volatility, ATR
opportunity, ATR beta
risk posture, low-
volatility shock
```
```
Scales opportunity
and penalizes unstable
entries
```
```
Streaming variance
and range statistics,
Theta(n)
```
```
Positive when volatility
creates opportunity;
negative or
discounting when it
makes execution
unreliable
```
Volume, liquidity, and
microstructure

```
spread, dollar volume,
volume shock, quote
age, tradeability,
partial-fill risk
```
```
Decides whether the
forecast can be
converted into
executable after-cost
value
```
```
Cached quote and bar
liquidity state,
Theta(n) for
universe refresh and
Theta(m q) for
action gate
```
```
Often dominates the
gateway explanation
even when it
contributes little to
raw alpha
```
Fundamental analysis
and quality

```
growth-quality style
inputs, relative-
strength quality,
earnings-style quality,
liquidity-quality
descriptors
```
```
Slow prior; stabilizes
noisy short-horizon TA
with business-quality
context
```
```
Refreshed at lower
frequency, joined
causally, O(n) per
refresh
```
```
family_abs_share_{fu
ndamental,i,t,h}
explains how much
the signal depends on
FA rather than
intraday movement
```
Source and
provenance role

```
primary source
member, secondary
source member,
retained baseline
member, prior target
membership, source
rank, source weight
```
```
Encodes that a
validated source
package has selected
this security for the
current regime
```
```
Computed on the
compact source slate,
O(m)
```
```
Can be a large positive
prior, then dynamically
discounted by
execution and regime
evidence
```
Event and semantic
context

```
company catalyst,
relative conviction,
sector stabilization,
positive event
evidence
```
```
Adds conditional
evidence when
narrative or event data
supports a move
```
```
Cached event features
with bounded joins,
O(n) for refreshed
rows
```
```
Contribution is
episodic: small most
of the time, material
when a catalyst is
active
```
Market regime and
session context

```
broad market return,
broad volatility,
breadth,
weekday/session
bucket, holiday or
shortened-session
state, gap to next
session
```
```
Changes how much
other signals should
be trusted and how
expensive trading is
```
```
Mostly shared state,
O(1) to update plus
O(n) to apply
```
```
Usually appears as an
adjustment or
multiplier rather than
a standalone ticker
vote
```
Portfolio and account
state

```
current weight, target
delta, drift, cash-only
trade budget, open
orders, recent fills
```
```
Converts a desired
target into a feasible
action package
```
```
O(positions + orders
+ m q)
```
```
Explains why a high-
scoring target may be
held, delayed,
reduced, or funded by
a sell leg
```
Realized execution
telemetry

```
recent slippage, fill
quality, queue delay,
replacement history,
unresolved fill state
```
```
Feeds the adaptive
friction surface and
prevents repeated
execution mistakes
```
```
Event-log updates,
O(events_t) per
cycle
```
```
Contribution is usually
subtractive: it raises or
lowers the hurdle
before a trade is
allowed
```

The same accounting can be made more granular. The following ledger describes how each
representative indicator contributes to the end signal. The amount is not a permanent hand-written
weight; it is the row-specific basis-point contribution:

```
amountj
=
indicator_contributionj,i,t,h
relativeamount j
=
signed_sharej,i,t,h
absoluteimportance j
=
abs_sharej,i,t,h
```
**Technical analysis.**

```
trendscore: amount 𝔼[βtrend ∣ D] · ztrend. High absolute
importance means the target is mostly a trend-following decision.
relativestrength score: amount 𝔼[βrs ∣ D] · zrs. Positive relative
amount means the name is leading peers, not merely rising with the market.
breakoutscore: amount 𝔼[βbreakout ∣ D] · zbreakout. Large positive
relative amount means the model is paying for continuation evidence.
upsidetorque score: amount 𝔼[βtorque ∣ D] · ztorque. This is usually
a timing contributor; it is large only when the current move is unusually
forceful.
nextsession green probability: amount 𝔼[βgreen ∣ D] · zgreen. This
converts a probability-style feature into basis points before cost
subtraction.
supportdefense score: amount 𝔼[βsupport ∣ D] · zsupport. Positive
relative amount means chart structure is reducing downside concern.
extensionalignment score: amount 𝔼[βextension ∣ D] · zextension. It
can support continuation or reduce edge when the extension looks exhausted.
oversoldreversal score: amount 𝔼[βoversold ∣ D] · zoversold. High
importance means the decision is more reversal-based than momentum-based.
```
**Volatility, range, and execution capacity.**

```
realizedvolatility bps: amount 𝔼[βvol ∣ D] · zvol. It contributes
positively when movement creates opportunity and negatively when movement
mostly adds markout risk.
```

```
atropportunity score: amount 𝔼[βatr ∣ D] · zatr. It helps explain
whether the expected move is large enough to pay the gateway.
atr_βrisk posture: amount 𝔼[βatr_β ∣ D] · zatr_β. It is
usually a discounting contributor when market risk is elevated.
volumeshock score: amount 𝔼[βvolume shock ∣ D] · zvolume shock.
Positive relative amount means current participation supports entry.
spreadbps: amount - Cspread(i,t). Large absolute importance means
execution cost, not alpha, is driving the trade decision.
quoteage seconds: amount - Cstale(i,t). High importance means the model
is refusing to trust the visible price.
dollarvolume capacity: amount - Cliquidity(i,t). High importance means
capacity or partial-fill risk is controlling size or timing.
imminenttradeability score: amount
𝔼[βtradeability ∣ D] · ztradeability. Positive relative amount means
execution conditions themselves support action.
```
**Fundamental analysis.**

```
qualitygrowth score: amount 𝔼[βquality ∣ D] · zquality. High
importance means the decision is being stabilized by FA rather than only
intraday TA.
relativestrength quality score: amount
𝔼[βquality rs ∣ D] · zquality rs. High importance means business-quality
and price-strength evidence agree.
liquidityquality score: amount
𝔼[βliquidity quality ∣ D] · zliquidity quality. Positive amount supports
deployability; negative amount raises gateway skepticism.
earningsquality proxy: amount
𝔼[βearnings quality ∣ D] · zearnings quality. It is usually a background
prior and should not dominate unless posterior evidence supports it.
```
**Source, event, and regime evidence.**

```
primarysource member: amount
sourcerole edge primary · dynamicmultiplier. Large positive importance
means validated source membership is a central reason for the target.
secondarysource member: amount
sourcerole edge secondary · dynamicmultiplier. It is smaller than the
primary role unless regime evidence raises its multiplier.
retainedmember: amount sourcerole edge retained · dynamicmultiplier.
This supports continuity when the model still has evidence but not full
```

```
primary conviction.
priortarget weight: amount 𝔼[βprior weight ∣ D] · zprior weight.
High importance means learned target continuity is contributing evidence.
companyspecific catalyst: amount
𝔼[βcatalyst ∣ D] · zcatalyst. This should become large only when
ticker-specific event evidence is active.
semanticrelative conviction: amount
𝔼[βsemantic ∣ D] · zsemantic. High importance means non-price evidence
is materially affecting rank.
sectorstabilization score: amount 𝔼[βsector ∣ D] · zsector. It helps
distinguish isolated ticker noise from group-supported movement.
marketreturn 5 bps: amount 𝔼[βmarket ret ∣ D] · zmarket ret. It
usually modifies bullish or defensive confidence rather than selecting a name
alone.
marketvolatility 21 bps: amount 𝔼[βmarket vol ∣ D] · zmarket vol.
It often increases uncertainty discount and execution hurdle.
breadthstate: amount 𝔼[βbreadth ∣ D] · zbreadth. Positive amount
supports broad regimes; negative amount warns that leadership is narrow.
```
**Calendar, portfolio, and execution telemetry.**

```
sessionbucket: amount sessionadjustment(t). It explains why the same
target can be tradable at one time and too costly at another.
gapdays to next trading session: amount - Cgap(i,t). High absolute
importance means calendar risk is raising the hurdle.
currentweight: amount rebalancestate adjustment(i,t). It explains
whether the model is adding, holding, trimming, or avoiding duplicate exposure.
target_δ: amount target_δvalue(i,t). High importance means the
action is driven by portfolio drift, not only standalone alpha.
openorder state: amount - Creplace or duplicate(i,t). High importance
means order hygiene is controlling behavior.
recentslippage bps: amount - Crecent slippage(i,t). It makes the system
stricter when real fills are worse than modeled fills.
partialfill state: amount - Cpartial or unresolved(i,t). High importance
means the model is protecting the account from messy execution state.
```
For a single inspected ticker, an explanation table can be produced as:


```
indicatorreport(i,t,h)
=
sortdescending by(
{
indicatorname j,
sourcefamily j,
zj,i,t,
𝔼[βj,h ∣ Dt-],
indicator_contributionj,i,t,h,
discounted_contributionj,i,t,h,
abs_sharej,i,t,h
}_{j= 1 }p,
absshare
)
```
This costs:

```
Cindicator report(i,t,h)
=
O(p log p)
```
For only the validated candidate slate:

```
Cindicator report(Mt,t,h)
=
O(m p log p)
```
Because m is bounded, detailed explanations are cheap enough to generate for the selected names
without slowing the universe scan.

For validation and documentation, the system can summarize indicator importance over a replay
window:


```
medianfamily_shareg,h
=
median over (i,t) in selectedcandidates
of familyabs_shareg,i,t,h
tailfamily_shareg,h
=
ℙ(
familyabs_shareg,i,t,h ≥ 0. 25
| (i,t) in selectedcandidates
)
```
The median tells how much a family usually matters. The tail probability tells how often that family
becomes a dominant reason for selection. This is better than a permanent static percentage because a
technical indicator, a fundamental indicator, and a liquidity penalty should not have the same
influence in every regime.

### 74. Self-Testing Replay Loop As A Proof Harness

The self-testing loop is not a mathematical proof that future markets will pay the model. No replay
can prove that. It is a proof harness for a narrower and more important engineering claim:

```
Given the historical observations available at each time t,
the implementation computed the intended causal decision rule,
charged the intended costs,
respected the intended feasibility constraints,
and produced the reported action ledger without hidden missing state.
```
Let S be the written specification and I be the implementation. Let statet contain only information
available at or before time t. The specification oracle is:

```
OS(statet)
=
arg maxa in A t
QS(a,t)
```
The implementation output is:


```
OI(statet)
=
action emitted by the executable system at time t
```
The self-test certificate is:

```
selftest certificate
=
I[
for all t in replay window:
featuresare causal t
and costsare recomputable t
and accountstate transition matches t
and nounresolved required field t
and nounexpected missing value t
and OI(statet) = OS(statet)
]
```
The equality OI(statet) = OS(statet) does not require every internal floating-point value to be textually
identical. It requires the executable decision to match after applying the same rounding, cash-only
feasibility, order-state, freshness, and action-priority rules.

Promotion evidence then adds performance and robustness requirements:

```
promotable(θ)
=
selftest certificate(θ) = 1
and fullwindow after cost return(θ)
> incumbentfull window after cost return
and missingrequired rows(θ) = 0
and unresolvedaction rows(θ) = 0
and deployabilityconstraints pass(θ) = 1
and causalor shadow evidence pass(θ) = 1
```
This turns backtesting from curve-fitting into a falsification loop. Each candidate is forced to answer:


```
1. Did it only use information available at the time?
2. Did it pay spread, slippage, queue, gap, stale-quote, reversal, and wait costs?
3. Did it respect cash-only action feasibility and order-state repair?
4. Did it beat holding, waiting, and alternate rotations?
5. Did it survive the full window rather than only a favorable slice?
6. Did every required row resolve cleanly?
```
The loop becomes proof-like because it verifies implementation equivalence over a finite replay state
space. It is empirical with respect to market returns, but deductive with respect to the executed
recurrence:

```
If every replay state is reconstructed causally,
and every executable decision equals the specification oracle,
and every reported metric is recomputed from the resulting ledger,
then the replay report is a certificate of what this implementation would have
done on that replay data under the modeled execution assumptions.
```
The efficient replay cost follows the same bound as the practical algorithm:

```
Cself test(B,T,n)
=
O(
B T
(
n pactive
+ G dmax^2
+ n k
+ n log m
+ m q
+ eventst
)
)
```
Under bounded design dimensions:

```
Cself test(B,T,n)
=
Θ(B T n)
```

The self-testing loop was critical because it exposed which parts of the theory could be represented as
cached sufficient statistics, which parts needed a deterministic cost oracle, and which parts had to
remain promotion-blocked until clean causal evidence existed. In that sense, the loop is not merely a
testing tool. It is how the applied algorithm becomes a computational object precise enough to reason
about.

### 75. Thesis-Level Summary

The original optimal trading theory defines the right objective: choose the action that maximizes
expected utility after costs, risk, and alternatives. The applied model shows how to approximate that
objective in a practical implementation.

The 2021 Bayesian MIDAS penalized regression paper deserves substantial credit for the modeling
philosophy. Its central lesson is that high-dimensional, mixed-frequency, correlated predictors
should be handled through grouped Bayesian shrinkage and posterior predictive discipline. The
applied trading system adapts that lesson from macroeconomic nowcasting to intraday after-cost
action selection.

The current applied implementation is best understood as:

```
a validated baseline source-selector trading surface
+ provenance-aware action edge
+ adaptive dynamic-friction multiplier surface
+ dynamic friction execution gate
+ rotation-funded sell logic
+ practical reconciliation realism
+ linear-time candidate pruning and cost-oracle evaluation
+ prospective shadow evaluation monitor
+ self-testing replay proof harness
```
It is not the final form of the theory. It is a deployable approximation that keeps the strongest
validated behavior active while continuously updating bounded dynamic multipliers and collecting
the evidence needed to promote broader adaptive action surfaces later.

The path forward is also clear:


```
1. Continue collecting clean prospective shadow outcomes.
2. Mature dynamic action surface evidence.
3. Continue posterior calibration of regime-specific dynamic friction
multipliers.
4. Promote broader action-surface changes only from full-window or causal shadow
evidence.
5. Expand the Bayesian grouped posterior into the practical target and covariance
layers when it clears deployability gates.
```
The practical philosophy is simple:

```
Trust evidence, discount uncertainty, charge every action for friction,
and promote only what survives realistic implementation conditions.
```
That philosophy is what connects the theoretical optimum, the Bayesian literature, the current
algorithm, and the broader scientific use of this approach.

### 76. Toward A General Optimal Action Theory

The trading version of this paper is a specific instance of a more general pattern. The front-end
problem can be thought of as oracle math: given an arbitrarily large information set that is not pure
noise, estimate the future state as efficiently as possible under uncertainty. The word "oracle" does
not mean supernatural certainty. It means the mathematical limit of using every causal, correlated,
timely, and measurable signal without overbelieving noise.

In general form, the first optimization problem is:

```
bestposterior future state t
=
ℙ(Yt+h ∣ It)
```
where:

```
It is the full information set available at decision time;
Yt+h is the future state or outcome distribution being forecast;
the model should preserve useful correlation, shrink weak evidence, discount
stale evidence, and express uncertainty honestly.
```
This is the forecasting layer. In trading, it estimates future after-cost return, volatility, liquidity, and
account-state consequences. In other domains, it may estimate a storm track, a hospital deterioration
probability, a sports outcome, a supply-chain delay, a cyberattack path, or an equipment-failure
distribution.


The second optimization problem is action selection. Once the system has a posterior over the future,
it should not simply choose the highest raw forecast. It should choose the feasible action with the
highest expected value after costs, constraints, risk, delay, opportunity cost, and uncertainty:

```
a*t
=
arg maxa in A t
𝔼[
U(Yt+h, statet+h)
```
- actioncost(a, statet)
- opportunitycost(a, statet)
- riskpenalty(a, statet)
| It, a
]

This is the control layer. It converts belief into behavior. The forecast says what is likely. The action
optimizer decides what to do about it.

Together, those two layers define a generalized Optimal Action Theory:

```
Optimal Action Theory
=
efficient posterior prediction over future states
+ expected-value-maximizing action under real constraints
+ continuous causal self-testing against realized outcomes
```
The framework is useful anywhere the future is uncertain, the data is noisy but not meaningless, and
actions have asymmetric consequences.

In meteorology, the oracle layer estimates the distribution of possible tornado touchdown paths from
radar, satellite, surface observations, numerical weather models, terrain, historical storm analogs,
and real-time storm-cell structure. The action layer decides whether to issue a warning, pre-position
emergency services, delay school dismissal, open shelters, stage grid crews, or hold because the false-
alarm cost is still larger than the expected mitigation value. The optimal action is not "the model says
tornado." It is the warning or preparation policy with the best expected public-safety value after false
alarms, warning fatigue, evacuation risk, lead time, and resource constraints.

In sports forecasting, the oracle layer estimates the distribution of game outcomes from roster
quality, injuries, matchups, fatigue, coaching tendencies, weather, travel, market prices, and
historical comparable games. The action layer decides whether any wager, hedge, abstention, or
portfolio of bets has positive expected value after vig, line movement, bankroll risk, correlation
among bets, legal constraints, and uncertainty. The optimal action may be no bet, even when the
model has a favorite, because prediction edge and executable edge are different objects.


In medicine, the oracle layer estimates patient deterioration, treatment response, readmission risk,
or diagnostic likelihood from vitals, labs, imaging, notes, medications, comorbidities, and capacity.
The action layer decides whether to escalate care, order imaging, discharge, observe, administer
treatment, or allocate scarce staff. The cost function includes missed diagnosis, overtreatment risk,
patient burden, capacity, timing, and reversibility.

In energy-grid operations, the oracle layer estimates demand, renewable generation, equipment
stress, price, outage risk, and weather-driven load. The action layer decides whether to dispatch
reserves, buy power, defer maintenance, curtail load, or isolate equipment. The cost function
includes reliability, startup cost, ramp limits, market prices, outage probability, and the value of
waiting for a clearer signal.

In industrial maintenance, the oracle layer estimates failure risk from sensor streams, usage patterns,
maintenance records, production schedules, and environmental conditions. The action layer decides
whether to keep running, inspect, slow production, replace a part, or shut down. The optimal action
balances downtime, false alarms, catastrophic failure risk, spare-part availability, and production
opportunity cost.

In cybersecurity, the oracle layer estimates intrusion probability, attacker intent, blast radius, and
likely next movement from logs, endpoint telemetry, identity signals, network flows, threat
intelligence, and historical incidents. The action layer decides whether to alert, quarantine, revoke
credentials, block traffic, preserve evidence, or keep observing. The best response is not the highest
anomaly score; it is the containment policy with the best expected security value after operational
disruption, false positives, attacker adaptation, and evidence preservation.

These examples share the same mathematical skeleton:

```
1. Observe a large, mixed-frequency, noisy information set.
2. Estimate a posterior distribution over future states.
3. Define feasible actions.
4. Price the cost, delay, risk, and opportunity cost of each action.
5. Choose the action with the highest expected after-cost utility.
6. Compare realized outcomes against the prediction and action policy.
7. Promote only policies that improve out-of-sample or prospective causal value.
```
The trading system is therefore one concrete laboratory for a broader theory. Finance makes the
objective unusually measurable because profit and loss expose whether prediction and action were
aligned. But the deeper idea is not limited to finance. The deeper idea is that prediction alone is
incomplete. The useful object is a closed loop:

```
information → posterior future state → feasible action set → after-cost value
→ action → realized outcome → model update
```

The only meaningful conceptual extension beyond that loop is not a new kind of decision theory. It is
the data-acquisition version of the same action problem: how much additional data is worth
collecting before acting. That can be written as a value-of-information calculation:

```
d*t
=
arg maxd in D t
(
EZ d ∣ I t
[
maxa in A t EV(a ∣ It, Zd)
]
```
- maxa in A t EV(a ∣ It)
- datacollection cost(d)
- delaycost(d)
)

where d is a possible data-collection action, such as buying another dataset, waiting for another
observation, querying a sensor, running a more expensive model, asking for expert review, or
widening the evidence window. The system should collect more data only when the expected
improvement in the eventual action exceeds the cost and delay of collecting it. It should stop
collecting data when the marginal expected decision improvement is lower than the marginal
collection cost, or when the posterior action gap is already precise enough that additional
information is unlikely to change the chosen action.

That extension is important operationally, but it is conceptually straightforward. It treats
information as another purchasable action whose value is measured by how much it improves the
final decision, not by how large the dataset becomes.

One level above data acquisition is the question of whether the problem itself is worth optimizing,
and to what degree. That is also a cost-benefit calculation. For a candidate problem p, the system can
compare the expected value of optimizing it against the default, heuristic, or good-enough policy:


```
e*p
=
arg maxe in E p
(
𝔼[
maxa in A p EVp(a ∣ Ip, modele)
]
```
- EVp(defaultpolicy)
- optimizationcost p(e)
- maintenancecost p(e)
- complexitycost p(e)
)

where e is the degree of optimization effort: doing nothing, using a rule of thumb, collecting a little
evidence, building a calibrated model, maintaining a standing monitor, or running a full causal
evaluation loop. If every nontrivial e has negative net value, the optimal action is not to optimize the
problem. If a small heuristic captures nearly all available value, the optimal action is to stop there.

This matters because universal optimization does not imply optimizing every decision to maximum
precision. Some decisions are too small. For example, it may be mathematically possible to model the
optimal toothbrush, brushing pattern, and brush-head replacement schedule, but the expected
benefit may be dominated by research time, cognitive overhead, purchase friction, and maintenance
burden. A simple rule such as "buy a reputable toothbrush and replace the brush head on a
reasonable schedule" may be the true optimum after optimization cost is charged.

So the full hierarchy is:

```
1. Is this problem worth optimizing at all?
2. If yes, how much optimization effort is worth buying?
3. Given that effort level, how much data is worth collecting?
4. Given the resulting posterior, which action has the highest after-cost value?
```
This does not contradict Optimal Action Theory. It completes it. The decision to ignore, approximate,
or deeply optimize a problem is itself an action, and it should be judged by the same expected after-
cost value rule as every other action.

That loop is the generalized form of the paper. It is a theory of how to act when the future is partially
predictable, action is costly, and the goal is not to be right in the abstract, but to choose the decision
that produces the best expected real-world result.


### 77. Cultural Analogy: Westworld Season 3

At supercomputer scale, this theory starts to resemble the central premise of Westworld season 3. In
that story, a world-scale prediction system consumes vast amounts of human behavioral data,
models individual and social trajectories, and uses those predictions to steer outcomes. The fictional
system is a dystopian version of the same abstract structure:

```
large-scale data ingestion
→ connected predictive model
→ forecast of future human and institutional states
→ intervention policy
→ observed response
→ model update
```
The difference is ethical and institutional, not mathematical. The mathematics of Optimal Action
Theory says that if enough causal signals are connected, a system can estimate how one event
changes the posterior distribution of many other events. Westworld season 3 imagines that same
logic pushed into a centralized social-control machine. The useful lesson is that prediction and action
are inseparable: a system that forecasts the future also changes the future when it acts on those
forecasts.

Connecting Bayesian DAGs across domains makes the idea concrete. A sports game, an equity
market, consumer behavior, media attention, local spending, social sentiment, betting flows,
employment schedules, and trading activity are not separate universes. They are different subgraphs
in one larger causal system. In principle, if the graph were broad enough and the evidence were
strong enough, it could ask questions such as:

```
ℙ(MU next-open return ∣ Ravens win, It)
versus
ℙ(MU next-open return ∣ Ravens lose, It)
```
The path from a Baltimore Ravens result to the next market-open price of MU would usually be
indirect and small, but it is not conceptually impossible. The effect could flow through regional
mood, discretionary spending, sports-media attention, betting gains or losses, social-network
sentiment, risk appetite, retail-trader attention, index or sector co-movement, Monday premarket
liquidity, or unrelated macro events that happen to be correlated with the same calendar and
attention regime. A sufficiently connected DAG would not assume the football game directly moves a
semiconductor stock. It would ask whether the win/loss state changes any intermediate posterior
variables that, after costs and uncertainty, alter the expected action.

That is the important generalization. Everything can be placed into one causal action graph if the
data and compute are large enough:


```
sports outcomes
→ public mood and attention
→ media and social narratives
→ spending, risk appetite, and order flow
→ market microstructure and price formation
→ optimal trading action
```
Most possible paths will be too weak, too noisy, too expensive to measure, or too small after costs to
matter. The theory does not say to trade every correlation. It says to preserve the possibility of weak
cross-domain causality, estimate its posterior value honestly, charge it for uncertainty and action
cost, and ignore it unless it changes the optimal action.

Westworld season 3 is therefore a useful cultural analogy for the outer limit of the theory: a
connected prediction-and-control graph over an entire society. The paper's version is narrower and
normative. It says that if such connected graphs are built, their outputs should still be governed by
explicit objectives, uncertainty, costs, consent, constraints, and the choice not to act when the
expected value does not justify intervention.

### 78. Responsible Release And Anti-Westworld Constraints

If this paper is released publicly, it should not be read as permission to optimize human beings under
someone else's hidden objective function. The mathematical structure can produce enormous value,
but the same structure can also become dangerous when prediction is joined to institutional power,
surveillance, coercion, or opaque denial of opportunity. The responsible release of Optimal Action
Theory therefore requires an explicit anti-Westworld layer.

The core distinction is:

```
decision support for people
versus
behavioral control over people
```
The first use is legitimate when it expands agency, reveals options, reduces risk, and helps a person
or community choose better actions according to objectives they can understand and contest. The
second use is illegitimate when it quietly narrows a person's future, manipulates their environment,
or assigns life outcomes through an objective function they did not choose.

Because the current world is governed by companies, states, markets, platforms, and institutions
with mixed incentives, this theory should be released with constraints. A system that applies Optimal
Action Theory to consequential human outcomes should satisfy at least the following conditions:


```
1. No covert behavioral manipulation.
2. No centralized social scoring.
3. No life-path control without meaningful consent.
4. No opaque denial of opportunity, credit, work, insurance, education,
healthcare, housing, or legal standing.
5. Human appeal rights for consequential decisions.
6. Clear disclosure when an optimizer materially shapes a person′s choices.
7. Transparent objective functions for systems that affect people.
8. Independent audits of data, models, interventions, and outcomes.
9. Data minimization and personal data control wherever feasible.
10. Separation between prediction and coercive enforcement.
11. The right to opt out when the optimization is not necessary for safety.
12. A bias toward decentralization, user-owned agents, and contestable systems.
```
The anti-Westworld rule can be written as a constraint on the optimization problem itself. For any
action policy π that affects people:

```
π is admissible only if:
expectedvalue(π)
is improved after costs
and π satisfies:
consentconstraint
dignityconstraint
transparencyconstraint
appealconstraint
auditconstraint
decentralizationconstraint
nonmanipulation constraint
```
If a policy produces profit, efficiency, or predictive accuracy by violating those constraints, then it is
not an optimal action. It is an incomplete objective function exploiting an omitted moral cost.

This also changes how the paper should be communicated. The phrase "unlimited wealth and
fortune" should be understood as a warning about capability, not as the final aim. If the public
framing invites powerful actors to maximize wealth, control, or institutional convenience without
limits, then the release has failed its own theory. The correct public framing is that better prediction
and better action must be used to increase human flourishing, reduce suffering, expand freedom, and
make institutions more accountable to the people affected by them.


The long-run question is therefore not whether optimization will spread. It will. The question is
whether the objective functions belong to people or merely to the institutions that model them. A
Westworld-like future emerges when prediction becomes centralized, opaque, coercive, and
unappealable. A better future emerges when prediction is bounded, transparent, consent-based,
decentralized, and placed in service of human agency.

This paper should be released only with that distinction made explicit:

```
Use Optimal Action Theory to help people choose.
Do not use it to choose for them.
```
### 79. Author's Final Closing Thoughts

My hope is that the world takes this concept and uses it for the betterment of mankind. The theory in
this paper can be read as a tool for unlimited wealth and fortune, because it describes how to connect
evidence, prediction, action, and feedback until decisions improve without bound. But wealth is not
the final objective. It is only one possible output of better action.

Do not lose sight of what really matters. Life is finite in duration. Entropy is always increasing. Every
person has a limited amount of time, attention, health, and love to spend before the system they call
a life disperses back into the larger world. A theory of optimal action that forgets that fact is not
optimal. It is incomplete.

Use the machinery in this paper to reduce suffering, increase freedom, create abundance, and make
better choices with humility. Use it to build systems that help people understand their options rather
than systems that quietly trap them inside predicted paths. The cautionary lesson of Westworld
season 3 is not that prediction is evil. It is that prediction without kindness, consent, humility, and
restraint becomes a machine for domination.

So the final instruction is simple:

```
Optimize the world, but do not forget the people living in it.
Seek abundance, but do not worship it.
Predict the future, but do not imprison anyone inside the prediction.
Be kind to others.
```
If this theory becomes useful, let it be useful in the service of human flourishing. Let it make people
richer where wealth helps, safer where risk can be reduced, freer where systems have become too
rigid, and wiser where noise has hidden the better path. The goal is not merely to win. The goal is to
help civilization choose better actions without becoming the dystopia it was trying to avoid.


### Aside

Sorry if any of this came off as grandiose, egotistical, or preachy; that was not my intent. I ran this
same prediction model to determine what would happen if I released this paper without an ethical
usage section, and the chances of it being misused were too high for me to want to release it that way.
When I added this section, the chance of this being misused at a societal scale trended toward zero.

I do not claim to be a master of ethics by any stretch. I only thought it would be unwise to release this
without at least proposing a suggested framework for how the concept could be used responsibly.



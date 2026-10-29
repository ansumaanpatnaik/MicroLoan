"use client";

import {
  BrowserProvider,
  Contract,
  isAddress,
  type ContractTransactionResponse,
  type Eip1193Provider,
} from "ethers";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Check,
  CircleAlert,
  Clock3,
  Coins,
  HandCoins,
  Landmark,
  LoaderCircle,
  RefreshCw,
  Wallet,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { MICROLOAN_ABI, type Loan } from "./lib/microloan";

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (value: unknown) => void) => void;
  removeListener?: (event: string, listener: (value: unknown) => void) => void;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

type View = "borrower" | "lender";

const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_MICROLOAN_ADDRESS ?? "";
const SEPOLIA_CHAIN_ID = 11155111;
const STATUS_NAMES = ["Requested", "Funded", "Withdrawn", "Repaid", "Defaulted", "Expired"];

function getProvider() {
  if (!window.ethereum) throw new Error("Install MetaMask to use the loan market.");
  return new BrowserProvider(window.ethereum as unknown as Eip1193Provider);
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function weiAmount(value: bigint) {
  return `${value.toString()} wei`;
}

function dateLabel(timestamp: bigint) {
  return new Date(Number(timestamp) * 1000).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function duePassed(timestamp: bigint) {
  return BigInt(Math.floor(Date.now() / 1000)) > timestamp;
}

function LoanStatus({ status }: { status: number }) {
  const name = STATUS_NAMES[status] ?? "Unknown";
  return <span className={`status status-${name.toLowerCase()}`}>{name}</span>;
}

function WalletButton({ account, onConnect }: { account: string; onConnect: () => void }) {
  return (
    <button className="wallet-button" onClick={onConnect} type="button">
      <Wallet size={16} aria-hidden="true" />
      {account ? shortAddress(account) : "Connect wallet"}
    </button>
  );
}

export default function Home() {
  const [view, setView] = useState<View>("borrower");
  const [account, setAccount] = useState("");
  const [chainId, setChainId] = useState<number | null>(null);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [principal, setPrincipal] = useState("");
  const [durationDays, setDurationDays] = useState("30");
  const [durationHours, setDurationHours] = useState("0");
  const [durationMinutes, setDurationMinutes] = useState("0");
  const [durationSeconds, setDurationSeconds] = useState("0");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const configured = isAddress(CONTRACT_ADDRESS);
  const onSepolia = chainId === SEPOLIA_CHAIN_ID;
  const canTransact = Boolean(account && onSepolia && configured);

  useEffect(() => {
    const ethereum = window.ethereum;
    if (!ethereum?.on) return;

    const onAccountsChanged = (value: unknown) => {
      const accounts = Array.isArray(value) ? value : [];
      setAccount(typeof accounts[0] === "string" ? accounts[0] : "");
      setLoans([]);
    };
    const onChainChanged = (value: unknown) => {
      const parsed = typeof value === "string" ? Number(value) : NaN;
      setChainId(Number.isFinite(parsed) ? parsed : null);
      setLoans([]);
    };

    ethereum.on("accountsChanged", onAccountsChanged);
    ethereum.on("chainChanged", onChainChanged);
    return () => {
      ethereum.removeListener?.("accountsChanged", onAccountsChanged);
      ethereum.removeListener?.("chainChanged", onChainChanged);
    };
  }, []);

  async function refreshLoans() {
    if (!configured) return;
    setLoading(true);
    setError("");
    try {
      const contract = new Contract(CONTRACT_ADDRESS, MICROLOAN_ABI, getProvider());
      const count = (await contract.nextLoanId()) as bigint;
      const ids = Array.from({ length: Number(count) }, (_, index) => index);
      const records = await Promise.all(ids.map((id) => contract.loans(id)));
      setLoans(
        records.map((record, index) => ({
          id: BigInt(index),
          borrower: record.borrower as string,
          lender: record.lender as string,
          principal: record.principal as bigint,
          repayment: record.repayment as bigint,
          dueDate: record.dueDate as bigint,
          status: Number(record.status),
        })),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load loans.");
    } finally {
      setLoading(false);
    }
  }

  async function connectWallet() {
    setError("");
    setNotice("");
    try {
      const provider = getProvider();
      const accounts = (await provider.send("eth_requestAccounts", [])) as string[];
      const network = await provider.getNetwork();
      setAccount(accounts[0] ?? "");
      setChainId(Number(network.chainId));
      if (Number(network.chainId) === SEPOLIA_CHAIN_ID && configured) {
        await refreshLoans();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Wallet connection was not completed.");
    }
  }

  async function switchToSepolia() {
    if (!window.ethereum) return;
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0xaa36a7" }],
      });
    } catch (caught) {
      if ((caught as { code?: number }).code !== 4902) {
        setError(caught instanceof Error ? caught.message : "Could not switch network.");
        return;
      }
      try {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: "0xaa36a7",
              chainName: "Sepolia",
              nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
              rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com"],
              blockExplorerUrls: ["https://sepolia.etherscan.io"],
            },
          ],
        });
      } catch (addError) {
        setError(addError instanceof Error ? addError.message : "Could not add Sepolia.");
      }
    }
  }

  async function transact(
    key: string,
    send: (contract: Contract) => Promise<ContractTransactionResponse>,
  ) {
    if (!canTransact) return;
    setBusy(key);
    setError("");
    setNotice("");
    try {
      const signer = await getProvider().getSigner();
      const contract = new Contract(CONTRACT_ADDRESS, MICROLOAN_ABI, signer);
      const transaction = await send(contract);
      setNotice("Transaction sent. Waiting for Sepolia confirmation…");
      await transaction.wait();
      setNotice("Confirmed on Sepolia.");
      await refreshLoans();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The transaction failed.");
    } finally {
      setBusy("");
    }
  }

  async function requestLoan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canTransact) return;
    setError("");
    try {
      if (!/^\d+$/.test(principal)) {
        throw new Error("Enter the loan amount as a whole number of wei.");
      }
      const amount = BigInt(principal);
      const days = BigInt(durationDays);
      const hours = BigInt(durationHours);
      const minutes = BigInt(durationMinutes);
      const seconds = BigInt(durationSeconds);
      if (
        amount <= 0n ||
        days < 0n ||
        hours < 0n ||
        hours > 23n ||
        minutes < 0n ||
        minutes > 59n ||
        seconds < 0n ||
        seconds > 59n
      ) {
        throw new Error("Enter a positive amount and a valid duration.");
      }
      const duration = days * 86_400n + hours * 3_600n + minutes * 60n + seconds;
      if (duration <= 0n) throw new Error("Enter a duration greater than zero.");
      const repayment = amount + amount / 50n;
      await transact("request", (contract) =>
        contract.requestLoan(amount, repayment, duration) as Promise<ContractTransactionResponse>,
      );
      setPrincipal("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Check the loan details and try again.");
    }
  }

  const myLoans = loans.filter((loan) => loan.borrower.toLowerCase() === account.toLowerCase());
  const requestedLoans = loans.filter((loan) => loan.status === 0 && !duePassed(loan.dueDate));
  const myPortfolio = loans.filter((loan) => loan.lender.toLowerCase() === account.toLowerCase());
  const activeCount = loans.filter((loan) => loan.status === 1 || loan.status === 2).length;

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#market" aria-label="MicroLoan home">
          <span className="brand-mark"><Landmark size={19} strokeWidth={2.2} /></span>
          <span>Micro<span className="brand-light">Loan</span></span>
        </a>
        <div className="topbar-right">
          <span className={`network-label ${onSepolia ? "network-live" : ""}`}>
            <span className="network-dot" />
            {chainId === null ? "Wallet not connected" : onSepolia ? "Sepolia testnet" : "Wrong network"}
          </span>
          <WalletButton account={account} onConnect={connectWallet} />
        </div>
      </header>

      <div className="workspace" id="market">
        <section className="page-heading">
          <div>
            <p className="eyebrow"><span>COMMUNITY CREDIT</span><span className="eyebrow-rule" />TESTNET MARKET</p>
            <h1>Small loans.<br /><span>Clear terms.</span></h1>
            <p className="intro-copy">A direct lending pool for independent makers. Every term and transfer is recorded on-chain.</p>
          </div>
          <div className="heading-side">
            <div className="seal"><HandCoins size={23} /><span>PEER<br />TO PEER</span></div>
            <p>Sepolia only<br /><strong>No real funds</strong></p>
          </div>
        </section>

        <section className="market-strip" aria-label="Market overview">
          <div className="market-stat"><span>LOANS OPEN</span><strong>{requestedLoans.length.toString().padStart(2, "0")}</strong></div>
          <div className="market-stat"><span>IN PROGRESS</span><strong>{activeCount.toString().padStart(2, "0")}</strong></div>
          <div className="market-stat"><span>YOUR REQUESTS</span><strong>{myLoans.length.toString().padStart(2, "0")}</strong></div>
          <button className="icon-button refresh-button" onClick={refreshLoans} disabled={!configured || loading} title="Refresh market" aria-label="Refresh market">
            {loading ? <LoaderCircle className="spin" size={17} /> : <RefreshCw size={17} />}
          </button>
        </section>

        <nav className="role-tabs" aria-label="Choose your role">
          <button className={view === "borrower" ? "role-tab active" : "role-tab"} onClick={() => setView("borrower")} type="button">
            <ArrowDownLeft size={17} />Borrower
          </button>
          <button className={view === "lender" ? "role-tab active" : "role-tab"} onClick={() => setView("lender")} type="button">
            <ArrowUpRight size={17} />Lender
          </button>
          <span className="role-tabs-note"><ShieldCheckIcon />Non-custodial rules, enforced by contract</span>
        </nav>

        {!configured && <div className="callout warning"><CircleAlert size={18} /><span>Contract address not set. Add <code>NEXT_PUBLIC_MICROLOAN_ADDRESS</code> to <code>frontend/.env.local</code> after deployment.</span></div>}
        {configured && account && !onSepolia && (
          <div className="callout warning"><CircleAlert size={18} /><span>Switch MetaMask to Sepolia to read or write loan data.</span><button className="text-action" onClick={switchToSepolia} type="button">Switch network <ArrowLeftRight size={14} /></button></div>
        )}
        {error && <div className="callout error"><CircleAlert size={18} /><span>{error}</span><button className="dismiss" onClick={() => setError("")} aria-label="Dismiss error" type="button">×</button></div>}
        {notice && <div className="callout success"><Check size={18} /><span>{notice}</span></div>}

        {view === "borrower" ? (
          <div className="content-grid">
            <section className="request-panel">
              <div className="section-heading">
                <div><span className="section-index">01 / BORROWER</span><h2>Request a loan</h2></div>
                <span className="section-glyph glyph-coral"><Coins size={19} /></span>
              </div>
              <form className="request-form" onSubmit={requestLoan}>
                <label htmlFor="principal">Loan amount (wei)</label>
                <div className="amount-input-wrap"><input id="principal" autoComplete="off" inputMode="numeric" onChange={(event) => setPrincipal(event.target.value)} pattern="[0-9]*" placeholder="e.g. 1000000000000000000" required type="text" value={principal} /><span>wei</span></div>
                <label htmlFor="duration">Repayment window</label>
                <div className="duration-input-wrap"><input id="duration" min="0" onChange={(event) => setDurationDays(event.target.value)} required type="number" value={durationDays} /><span>days</span><Clock3 size={17} /></div>
                <div className="duration-units">
                  <div className="duration-unit">
                    <label htmlFor="duration-hours">Hours</label>
                    <div className="duration-input-wrap"><input id="duration-hours" max="23" min="0" onChange={(event) => setDurationHours(event.target.value)} required step="1" type="number" value={durationHours} /></div>
                  </div>
                  <div className="duration-unit">
                    <label htmlFor="duration-minutes">Minutes</label>
                    <div className="duration-input-wrap"><input id="duration-minutes" max="59" min="0" onChange={(event) => setDurationMinutes(event.target.value)} required step="1" type="number" value={durationMinutes} /></div>
                  </div>
                  <div className="duration-unit">
                    <label htmlFor="duration-seconds">Seconds</label>
                    <div className="duration-input-wrap"><input id="duration-seconds" max="59" min="0" onChange={(event) => setDurationSeconds(event.target.value)} required step="1" type="number" value={durationSeconds} /></div>
                  </div>
                </div>
                <div className="repayment-note"><span>Repayment (includes 2% fee)</span><span>{/^\d+$/.test(principal) && BigInt(principal) > 0n ? `${(BigInt(principal) + BigInt(principal) / 50n).toString()} wei` : "—"}</span></div>
                <button className="primary-button" disabled={!canTransact || Boolean(busy)} type="submit">
                  {busy === "request" ? <LoaderCircle className="spin" size={17} /> : <ArrowUpRight size={17} />}
                  {busy === "request" ? "Submitting…" : "Publish loan request"}
                </button>
                {!account && <p className="form-footnote">Connect your wallet to publish a request.</p>}
              </form>
            </section>

            <section className="loan-section">
              <div className="section-heading list-heading">
                <div><span className="section-index">YOUR ACTIVITY</span><h2>Borrower dashboard <span className="count-badge">{myLoans.length}</span></h2></div>
                <button className="inline-refresh" onClick={refreshLoans} disabled={!configured || loading} type="button" title="Refresh loans"><RefreshCw size={15} /></button>
              </div>
              {!account ? <EmptyState title="Your loans live here" detail="Connect the wallet used to request a loan to see its status and next steps." /> : myLoans.length === 0 ? <EmptyState title="No loan requests yet" detail="Create a request to get started. Once funded, you can withdraw and repay from here." /> : (
                <div className="loan-list">
                  {myLoans.map((loan) => <LoanRow key={loan.id.toString()} loan={loan} busy={busy} canTransact={canTransact} onAction={transact} />)}
                </div>
              )}
            </section>
          </div>
        ) : (
          <div className="lender-layout">
            <section className="loan-section market-list-section">
              <div className="section-heading list-heading">
                <div><span className="section-index">02 / LENDER</span><h2>Open requests <span className="count-badge">{requestedLoans.length}</span></h2></div>
                <p className="section-caption">Fund a request with its exact principal.</p>
              </div>
              {requestedLoans.length === 0 ? <EmptyState title="The market is quiet" detail="New borrower requests will appear here when they are published." /> : (
                <div className="loan-list">
                  {requestedLoans.map((loan) => (
                    <article className="loan-row lender-row" key={loan.id.toString()}>
                      <div className="loan-main"><span className="loan-id">LOAN #{loan.id.toString().padStart(4, "0")}</span><strong>{weiAmount(loan.principal)}</strong><span className="loan-person">Borrower · {shortAddress(loan.borrower)}</span></div>
                      <div className="loan-facts"><span>Repayment</span><strong>{weiAmount(loan.repayment)}</strong><span>Due {dateLabel(loan.dueDate)}</span></div>
                      <button className="fund-button" disabled={!canTransact || Boolean(busy) || duePassed(loan.dueDate) || loan.borrower.toLowerCase() === account.toLowerCase()} onClick={() => transact(`fund-${loan.id}`, (contract) => contract.fund(loan.id, { value: loan.principal }) as Promise<ContractTransactionResponse>)} type="button">
                        {busy === `fund-${loan.id}` ? <LoaderCircle className="spin" size={15} /> : <HandCoins size={15} />}{loan.borrower.toLowerCase() === account.toLowerCase() ? "Your request" : "Fund"}
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="loan-section portfolio-section">
              <div className="section-heading list-heading">
                <div><span className="section-index">YOUR CAPITAL</span><h2>Lending portfolio <span className="count-badge">{myPortfolio.length}</span></h2></div>
              </div>
              {!account ? <EmptyState title="Connect to view your portfolio" detail="Loans you fund will be tracked here through their full lifecycle." /> : myPortfolio.length === 0 ? <EmptyState title="No active positions" detail="Choose an open request above to fund your first loan." /> : (
                <div className="loan-list">
                  {myPortfolio.map((loan) => (
                    <article className="loan-row portfolio-row" key={loan.id.toString()}>
                      <div className="loan-main"><span className="loan-id">LOAN #{loan.id.toString().padStart(4, "0")}</span><strong>{weiAmount(loan.principal)}</strong><span className="loan-person">Borrower · {shortAddress(loan.borrower)}</span></div>
                      <div className="loan-facts"><span>Repayment</span><strong>{weiAmount(loan.repayment)}</strong><span>Due {dateLabel(loan.dueDate)}</span></div>
                      <LoanStatus status={loan.status} />
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        <footer className="footer"><span><span className="footer-mark" />Built for direct, transparent lending</span><a href={configured ? `https://sepolia.etherscan.io/address/${CONTRACT_ADDRESS}` : "https://sepolia.etherscan.io"} rel="noreferrer" target="_blank">Sepolia explorer <ArrowUpRight size={13} /></a></footer>
      </div>
    </main>
  );
}

function LoanRow({
  loan,
  busy,
  canTransact,
  onAction,
}: {
  loan: Loan;
  busy: string;
  canTransact: boolean;
  onAction: (key: string, send: (contract: Contract) => Promise<ContractTransactionResponse>) => Promise<void>;
}) {
  const actionKey = `loan-${loan.id}`;
  return (
    <article className="loan-row borrower-row">
      <div className="loan-main"><span className="loan-id">LOAN #{loan.id.toString().padStart(4, "0")}</span><strong>{weiAmount(loan.principal)}</strong><span className="loan-person">Repay {weiAmount(loan.repayment)}</span></div>
      <div className="loan-facts"><LoanStatus status={loan.status} /><span>Due {dateLabel(loan.dueDate)}</span>{loan.lender && loan.lender !== "0x0000000000000000000000000000000000000000" && <span>Lender · {shortAddress(loan.lender)}</span>}</div>
      <div className="loan-actions">
        {loan.status === 1 && !duePassed(loan.dueDate) && <button className="row-action" disabled={!canTransact || Boolean(busy)} onClick={() => onAction(actionKey, (contract) => contract.withdraw(loan.id) as Promise<ContractTransactionResponse>)} type="button">{busy === actionKey ? <LoaderCircle className="spin" size={15} /> : <ArrowDownLeft size={15} />}Withdraw</button>}
        {loan.status === 2 && !duePassed(loan.dueDate) && <button className="row-action action-green" disabled={!canTransact || Boolean(busy)} onClick={() => onAction(actionKey, (contract) => contract.repay(loan.id, { value: loan.repayment }) as Promise<ContractTransactionResponse>)} type="button">{busy === actionKey ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}Repay</button>}
      </div>
    </article>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="empty-state"><span className="empty-icon"><ArrowLeftRight size={19} /></span><strong>{title}</strong><p>{detail}</p></div>;
}

function ShieldCheckIcon() {
  return <span className="shield-check"><Check size={11} /></span>;
}

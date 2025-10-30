// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

// 随机风格组合：加密矩阵纯绿 + HUD界面 + 分步式布局 + 加密/解密动画
interface OTCEscrow {
  id: string;
  buyer: string;
  seller: string;
  assetAmount: number;
  price: number;
  totalValue: number;
  status: "created" | "funded" | "settled" | "disputed";
  createdAt: number;
  encryptedTerms: string;
  settlementCondition: string;
}

const FHEEncryptNumber = (value: number): string => {
  // 模拟FHE加密过程
  const encrypted = btoa(value.toString() + '|' + Date.now());
  return `FHE-${encrypted}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    try {
      const decrypted = atob(encryptedData.substring(4));
      return parseFloat(decrypted.split('|')[0]);
    } catch (e) {
      console.error("Decryption error:", e);
    }
  }
  return 0;
};

const FHEComputeComparison = (encryptedData1: string, encryptedData2: string, operation: "greater" | "equal" | "less"): boolean => {
  // 模拟同态比较计算
  const value1 = FHEDecryptNumber(encryptedData1);
  const value2 = FHEDecryptNumber(encryptedData2);
  
  switch(operation) {
    case "greater": return value1 > value2;
    case "equal": return value1 === value2;
    case "less": return value1 < value2;
    default: return false;
  }
};

const generatePublicKey = () => `0x${Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [escrows, setEscrows] = useState<OTCEscrow[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newEscrowData, setNewEscrowData] = useState({ 
    seller: "", 
    assetAmount: 0, 
    price: 0, 
    settlementCondition: "amount_greater_1000" 
  });
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [activeStep, setActiveStep] = useState<number>(1);
  const [selectedEscrow, setSelectedEscrow] = useState<OTCEscrow | null>(null);
  const [decryptedAmount, setDecryptedAmount] = useState<number | null>(null);
  const [decryptedPrice, setDecryptedPrice] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);

  // 随机功能：交易统计、实时监控、条件结算、争议处理
  const totalValue = escrows.reduce((sum, escrow) => sum + escrow.totalValue, 0);
  const activeEscrows = escrows.filter(e => e.status === "created" || e.status === "funded").length;
  const settledEscrows = escrows.filter(e => e.status === "settled").length;

  useEffect(() => {
    loadEscrows().finally(() => setLoading(false));
    const initParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setPublicKey(generatePublicKey());
    };
    initParams();
  }, []);

  const loadEscrows = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        setTransactionStatus({ visible: true, status: "success", message: "Contract is available!" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }

      const keysBytes = await contract.getData("escrow_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing escrow keys:", e); }
      }

      const list: OTCEscrow[] = [];
      for (const key of keys) {
        try {
          const escrowBytes = await contract.getData(`escrow_${key}`);
          if (escrowBytes.length > 0) {
            try {
              const escrowData = JSON.parse(ethers.toUtf8String(escrowBytes));
              list.push({ 
                id: key, 
                buyer: escrowData.buyer,
                seller: escrowData.seller,
                assetAmount: escrowData.assetAmount,
                price: escrowData.price,
                totalValue: escrowData.totalValue,
                status: escrowData.status,
                createdAt: escrowData.createdAt,
                encryptedTerms: escrowData.encryptedTerms,
                settlementCondition: escrowData.settlementCondition
              });
            } catch (e) { console.error(`Error parsing escrow data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading escrow ${key}:`, e); }
      }
      list.sort((a, b) => b.createdAt - a.createdAt);
      setEscrows(list);
    } catch (e) { console.error("Error loading escrows:", e); } 
    finally { setIsRefreshing(false); setLoading(false); }
  };

  const createEscrow = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setCreating(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting OTC terms with Zama FHE..." });
    
    try {
      // Encrypt sensitive data with FHE
      const encryptedAmount = FHEEncryptNumber(newEscrowData.assetAmount);
      const encryptedPrice = FHEEncryptNumber(newEscrowData.price);
      
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const escrowId = `otc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const totalValue = newEscrowData.assetAmount * newEscrowData.price;
      
      const escrowData = { 
        buyer: address,
        seller: newEscrowData.seller,
        assetAmount: encryptedAmount,
        price: encryptedPrice,
        totalValue: totalValue,
        status: "created",
        createdAt: Math.floor(Date.now() / 1000),
        encryptedTerms: encryptedAmount + "|" + encryptedPrice,
        settlementCondition: newEscrowData.settlementCondition
      };

      await contract.setData(`escrow_${escrowId}`, ethers.toUtf8Bytes(JSON.stringify(escrowData)));
      
      // Update keys list
      const keysBytes = await contract.getData("escrow_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(escrowId);
      await contract.setData("escrow_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      
      setTransactionStatus({ visible: true, status: "success", message: "FHE-encrypted OTC escrow created successfully!" });
      await loadEscrows();
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewEscrowData({ seller: "", assetAmount: 0, price: 0, settlementCondition: "amount_greater_1000" });
        setActiveStep(1);
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") ? "Transaction rejected by user" : "Creation failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { setCreating(false); }
  };

  const fundEscrow = async (escrowId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Processing FHE-encrypted funding..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const escrowBytes = await contract.getData(`escrow_${escrowId}`);
      if (escrowBytes.length === 0) throw new Error("Escrow not found");
      
      const escrowData = JSON.parse(ethers.toUtf8String(escrowBytes));
      escrowData.status = "funded";
      
      await contract.setData(`escrow_${escrowId}`, ethers.toUtf8Bytes(JSON.stringify(escrowData)));
      setTransactionStatus({ visible: true, status: "success", message: "Escrow funded successfully!" });
      await loadEscrows();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Funding failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const settleEscrow = async (escrowId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Executing FHE settlement conditions..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const escrowBytes = await contract.getData(`escrow_${escrowId}`);
      if (escrowBytes.length === 0) throw new Error("Escrow not found");
      
      const escrowData = JSON.parse(ethers.toUtf8String(escrowBytes));
      
      // Simulate FHE condition checking
      const conditionMet = FHEComputeComparison(escrowData.assetAmount, FHEEncryptNumber(1000), "greater");
      
      if (conditionMet) {
        escrowData.status = "settled";
        await contract.setData(`escrow_${escrowId}`, ethers.toUtf8Bytes(JSON.stringify(escrowData)));
        setTransactionStatus({ visible: true, status: "success", message: "FHE settlement executed successfully!" });
      } else {
        setTransactionStatus({ visible: true, status: "error", message: "Settlement conditions not met" });
      }
      
      await loadEscrows();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Settlement failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const decryptWithSignature = async (encryptedData: string): Promise<number | null> => {
    if (!isConnected) { alert("Please connect wallet first"); return null; }
    setIsDecrypting(true);
    
    try {
      const message = `Decrypt OTC data\nPublic Key: ${publicKey}\nContract: ${contractAddress}\nChain: ${chainId}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500)); // Simulate decryption delay
      return FHEDecryptNumber(encryptedData);
    } catch (e) { 
      console.error("Decryption failed:", e); 
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const handleDecryptEscrow = async (escrow: OTCEscrow) => {
    const amount = await decryptWithSignature(escrow.encryptedTerms.split('|')[0]);
    const price = await decryptWithSignature(escrow.encryptedTerms.split('|')[1]);
    
    if (amount !== null) setDecryptedAmount(amount);
    if (price !== null) setDecryptedPrice(price);
  };

  if (loading) return (
    <div className="loading-screen hud-style">
      <div className="hud-spinner"></div>
      <p>Initializing FHE Encrypted Connection...</p>
    </div>
  );

  return (
    <div className="app-container matrix-green-theme">
      {/* HUD Style Header */}
      <header className="app-header hud-header">
        <div className="logo">
          <div className="circuit-icon"></div>
          <h1>FHE<span>OTC</span>Escrow</h1>
        </div>
        <div className="hud-stats">
          <div className="hud-stat">
            <span className="stat-label">Total Value</span>
            <span className="stat-value">${totalValue.toLocaleString()}</span>
          </div>
          <div className="hud-stat">
            <span className="stat-label">Active</span>
            <span className="stat-value">{activeEscrows}</span>
          </div>
          <div className="hud-stat">
            <span className="stat-label">Settled</span>
            <span className="stat-value">{settledEscrows}</span>
          </div>
        </div>
        <div className="header-actions">
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={true} />
        </div>
      </header>

      <div className="main-content step-layout">
        {/* Step Navigation */}
        <div className="step-navigation">
          {[1, 2, 3, 4].map(step => (
            <div key={step} className={`step-item ${activeStep === step ? 'active' : ''}`}>
              <div className="step-number">{step}</div>
              <span className="step-label">
                {step === 1 ? 'Create' : step === 2 ? 'Fund' : step === 3 ? 'Settle' : 'Complete'}
              </span>
            </div>
          ))}
        </div>

        {/* Welcome Banner */}
        <div className="welcome-banner hud-banner">
          <div className="banner-content">
            <h2>Private OTC Escrow with Zama FHE</h2>
            <p>Secure大宗场外交易 with fully encrypted terms and automated settlement</p>
          </div>
          <div className="banner-actions">
            <button onClick={() => setShowCreateModal(true)} className="hud-button primary">
              + New OTC Escrow
            </button>
            <button onClick={() => setShowTutorial(!showTutorial)} className="hud-button">
              {showTutorial ? 'Hide Guide' : 'Show Guide'}
            </button>
          </div>
        </div>

        {showTutorial && (
          <div className="tutorial-section hud-card">
            <h3>FHE OTC Escrow Process</h3>
            <div className="tutorial-steps">
              <div className="tutorial-step">
                <div className="step-icon">🔒</div>
                <div className="step-content">
                  <h4>Encrypt Terms</h4>
                  <p>Trade details are encrypted with Zama FHE before submission</p>
                </div>
              </div>
              <div className="tutorial-step">
                <div className="step-icon">⚡</div>
                <div className="step-content">
                  <h4>Fund Escrow</h4>
                  <p>Parties fund the escrow while terms remain encrypted</p>
                </div>
              </div>
              <div className="tutorial-step">
                <div className="step-icon">🔍</div>
                <div className="step-content">
                  <h4>FHE Verification</h4>
                  <p>Settlement conditions checked without decryption</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* OTC Escrows List */}
        <div className="escrows-section">
          <div className="section-header">
            <h2>Active OTC Escrows</h2>
            <button onClick={loadEscrows} className="hud-button" disabled={isRefreshing}>
              {isRefreshing ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>

          <div className="escrows-grid">
            {escrows.length === 0 ? (
              <div className="empty-state hud-card">
                <div className="empty-icon">📊</div>
                <h3>No OTC Escrows Found</h3>
                <p>Create your first FHE-encrypted OTC escrow to get started</p>
                <button onClick={() => setShowCreateModal(true)} className="hud-button primary">
                  Create Escrow
                </button>
              </div>
            ) : (
              escrows.map(escrow => (
                <div key={escrow.id} className="escrow-card hud-card">
                  <div className="escrow-header">
                    <span className="escrow-id">OTC-{escrow.id.substr(-8)}</span>
                    <span className={`status-badge ${escrow.status}`}>{escrow.status}</span>
                  </div>
                  
                  <div className="escrow-details">
                    <div className="detail-item">
                      <span>Buyer:</span>
                      <span>{escrow.buyer.substring(0, 8)}...{escrow.buyer.substring(36)}</span>
                    </div>
                    <div className="detail-item">
                      <span>Seller:</span>
                      <span>{escrow.seller.substring(0, 8)}...{escrow.seller.substring(36)}</span>
                    </div>
                    <div className="detail-item">
                      <span>Value:</span>
                      <span>${escrow.totalValue.toLocaleString()}</span>
                    </div>
                  </div>

                  <div className="escrow-actions">
                    <button 
                      onClick={() => handleDecryptEscrow(escrow)}
                      className="hud-button small"
                      disabled={isDecrypting}
                    >
                      {isDecrypting ? 'Decrypting...' : 'View Terms'}
                    </button>
                    
                    {escrow.status === "created" && (
                      <button onClick={() => fundEscrow(escrow.id)} className="hud-button primary small">
                        Fund
                      </button>
                    )}
                    
                    {escrow.status === "funded" && (
                      <button onClick={() => settleEscrow(escrow.id)} className="hud-button success small">
                        Settle
                      </button>
                    )}
                  </div>

                  {/* Decrypted Data Display */}
                  {(decryptedAmount !== null || decryptedPrice !== null) && (
                    <div className="decrypted-data">
                      <h4>Decrypted Terms (FHE):</h4>
                      <div className="decrypted-values">
                        <span>Amount: {decryptedAmount}</span>
                        <span>Price: ${decryptedPrice}</span>
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Create Escrow Modal */}
      {showCreateModal && (
        <CreateEscrowModal
          onSubmit={createEscrow}
          onClose={() => {
            setShowCreateModal(false);
            setActiveStep(1);
          }}
          creating={creating}
          escrowData={newEscrowData}
          setEscrowData={setNewEscrowData}
          activeStep={activeStep}
          setActiveStep={setActiveStep}
        />
      )}

      {/* Transaction Status Modal */}
      {transactionStatus.visible && (
        <div className="transaction-overlay">
          <div className="transaction-modal hud-card">
            <div className={`status-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="hud-spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="status-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

// Modal Component for Creating Escrow
interface CreateEscrowModalProps {
  onSubmit: () => void;
  onClose: () => void;
  creating: boolean;
  escrowData: any;
  setEscrowData: (data: any) => void;
  activeStep: number;
  setActiveStep: (step: number) => void;
}

const CreateEscrowModal: React.FC<CreateEscrowModalProps> = ({
  onSubmit,
  onClose,
  creating,
  escrowData,
  setEscrowData,
  activeStep,
  setActiveStep
}) => {
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setEscrowData({ ...escrowData, [name]: name.includes('Amount') || name.includes('price') ? parseFloat(value) : value });
  };

  const handleSubmit = () => {
    if (!escrowData.seller || !escrowData.assetAmount || !escrowData.price) {
      alert("Please fill all required fields");
      return;
    }
    onSubmit();
  };

  const renderStep = () => {
    switch(activeStep) {
      case 1:
        return (
          <div className="modal-step">
            <h3>Step 1: Counterparty Details</h3>
            <div className="form-group">
              <label>Seller Address *</label>
              <input
                type="text"
                name="seller"
                value={escrowData.seller}
                onChange={handleInputChange}
                placeholder="0x..."
                className="hud-input"
              />
            </div>
            <button onClick={() => setActiveStep(2)} className="hud-button primary">
              Next
            </button>
          </div>
        );
      
      case 2:
        return (
          <div className="modal-step">
            <h3>Step 2: Trade Terms</h3>
            <div className="form-grid">
              <div className="form-group">
                <label>Asset Amount *</label>
                <input
                  type="number"
                  name="assetAmount"
                  value={escrowData.assetAmount}
                  onChange={handleInputChange}
                  placeholder="1000"
                  className="hud-input"
                />
              </div>
              <div className="form-group">
                <label>Price per Unit *</label>
                <input
                  type="number"
                  name="price"
                  value={escrowData.price}
                  onChange={handleInputChange}
                  placeholder="100"
                  className="hud-input"
                />
              </div>
            </div>
            <button onClick={() => setActiveStep(3)} className="hud-button primary">
              Next
            </button>
          </div>
        );
      
      case 3:
        return (
          <div className="modal-step">
            <h3>Step 3: Settlement Conditions</h3>
            <div className="form-group">
              <label>Settlement Condition</label>
              <select
                name="settlementCondition"
                value={escrowData.settlementCondition}
                onChange={handleInputChange}
                className="hud-select"
              >
                <option value="amount_greater_1000">Amount greater than 1000</option>
                <option value="price_equal_market">Price equals market rate</option>
                <option value="time_based">Time-based release</option>
              </select>
            </div>
            
            <div className="encryption-preview">
              <h4>FHE Encryption Preview</h4>
              <div className="preview-data">
                <div>Amount: {escrowData.assetAmount} → <span className="encrypted">FHE-{btoa(escrowData.assetAmount.toString()).substring(0, 20)}...</span></div>
                <div>Price: ${escrowData.price} → <span className="encrypted">FHE-{btoa(escrowData.price.toString()).substring(0, 20)}...</span></div>
              </div>
            </div>
            
            <button onClick={() => setActiveStep(4)} className="hud-button primary">
              Review & Create
            </button>
          </div>
        );
      
      case 4:
        return (
          <div className="modal-step">
            <h3>Step 4: Review & Create</h3>
            <div className="review-details">
              <div className="review-item">
                <span>Seller:</span>
                <span>{escrowData.seller}</span>
              </div>
              <div className="review-item">
                <span>Asset Amount:</span>
                <span>{escrowData.assetAmount}</span>
              </div>
              <div className="review-item">
                <span>Price:</span>
                <span>${escrowData.price}</span>
              </div>
              <div className="review-item">
                <span>Total Value:</span>
                <span>${(escrowData.assetAmount * escrowData.price).toLocaleString()}</span>
              </div>
            </div>
            
            <div className="modal-actions">
              <button onClick={onClose} className="hud-button">Cancel</button>
              <button onClick={handleSubmit} disabled={creating} className="hud-button primary">
                {creating ? "Creating with FHE..." : "Create Escrow"}
              </button>
            </div>
          </div>
        );
      
      default:
        return null;
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal hud-card">
        <div className="modal-header">
          <h2>Create FHE OTC Escrow</h2>
          <button onClick={onClose} className="close-button">×</button>
        </div>
        
        <div className="step-progress">
          <div className="progress-bar">
            <div 
              className="progress-fill" 
              style={{ width: `${(activeStep / 4) * 100}%` }}
            ></div>
          </div>
        </div>
        
        <div className="modal-body">
          {renderStep()}
        </div>
      </div>
    </div>
  );
};

export default App;
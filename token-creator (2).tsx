"use client"

import type React from "react"
import { useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Coins, ExternalLink } from "lucide-react"
import { DebugLog } from "@/components/debug-log"
import { NetworkSelector } from "@/components/network-selector"
import { AuthoritySettings } from "@/components/authority-settings"
import { TokenDetails } from "@/components/token-details"
import { CreatorInfo } from "@/components/creator-info"
import { uploadMetadataToArweave } from "@/lib/arweave-service"

// Import Solana libraries
import * as web3 from "@solana/web3.js"
import * as splToken from "@solana/spl-token"
import * as mplTokenMetadata from "@metaplex-foundation/mpl-token-metadata"
import bs58 from "bs58"

// Public RPC endpoints with CORS enabled
const PUBLIC_RPC_ENDPOINTS = {
  devnet: [
    "https://api.devnet.solana.com",
    "https://devnet.genesysgo.net/",
    "https://rpc-devnet.helius.xyz/?api-key=e2fe3651-c7fc-4560-9a4f-67f4f243727d",
  ],
  "mainnet-beta": [
    "https://api.mainnet-beta.solana.com",
    "https://rpc.helius.xyz/?api-key=e2fe3651-c7fc-4560-9a4f-67f4f243727d",
    "https://solana-mainnet.g.alchemy.com/v2/demo",
  ],
}

export default function TokenCreator() {
  // State for form values
  const [network, setNetwork] = useState("devnet")
  const [customRpcUrl, setCustomRpcUrl] = useState("")
  const [creatorPrivateKey, setCreatorPrivateKey] = useState("")
  const [tokenName, setTokenName] = useState("")
  const [tokenSymbol, setTokenSymbol] = useState("")
  const [totalSupply, setTotalSupply] = useState("")
  const [decimals, setDecimals] = useState("9")
  const [description, setDescription] = useState("")
  const [website, setWebsite] = useState("")
  const [uploadedIconDataUrl, setUploadedIconDataUrl] = useState("")

  // Authority settings
  const [mintAuthority, setMintAuthority] = useState("keep")
  const [freezeAuthority, setFreezeAuthority] = useState("keep")
  const [updateAuthority, setUpdateAuthority] = useState("keep")
  const [mintAuthorityAddress, setMintAuthorityAddress] = useState("")
  const [freezeAuthorityAddress, setFreezeAuthorityAddress] = useState("")
  const [updateAuthorityAddress, setUpdateAuthorityAddress] = useState("")

  // Status and logs
  const [status, setStatus] = useState("Status: Idle")
  const [logs, setLogs] = useState<string[]>([])
  const [isCreating, setIsCreating] = useState(false)
  const [result, setResult] = useState<any>(null)

  // Debug log function
  const addLog = useCallback((message: string) => {
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`])
  }, [])

  // Handle icon upload
  const handleIconUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      // Check file size (max 200KB)
      if (file.size > 200 * 1024) {
        alert("File is too large. Maximum size is 200KB.")
        return
      }

      const reader = new FileReader()
      reader.onload = (e) => {
        const result = e.target?.result as string
        setUploadedIconDataUrl(result)
      }
      reader.readAsDataURL(file)
    } else {
      setUploadedIconDataUrl("")
    }
  }

  // Validate Solana address
  const isValidSolanaAddress = (address: string) => {
    try {
      new web3.PublicKey(address)
      return true
    } catch {
      return false
    }
  }

  // Test connection to an RPC endpoint
  const testConnection = async (url: string) => {
    try {
      addLog(`Testing connection to ${url}...`)
      const connection = new web3.Connection(url, "confirmed")
      const blockHeight = await connection.getBlockHeight()
      addLog(`✅ Connected to ${url} (block height: ${blockHeight})`)
      return connection
    } catch (err: any) {
      addLog(`❌ Failed to connect to ${url}: ${err.message}`)
      return null
    }
  }

  // Find metadata PDA from mint
  const findMetadataPda = useCallback((mint: web3.PublicKey) => {
    const metadataProgramId = new web3.PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s")

    const [metadataPDA] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("metadata"), metadataProgramId.toBuffer(), mint.toBuffer()],
      metadataProgramId,
    )

    return { metadataPDA, metadataProgramId }
  }, [])

  // Create token function
  const createToken = async () => {
    setLogs([])
    setStatus("⏳ Initializing...")
    setIsCreating(true)
    setResult(null)

    try {
      let networkValue = network.trim().toLowerCase()
      // Normalize network value to exactly 'devnet' or 'mainnet-beta'
      if (networkValue === "devnet" || networkValue === "dev") {
        networkValue = "devnet"
      } else if (networkValue === "mainnet-beta" || networkValue === "mainnet" || networkValue === "mainnetbeta") {
        networkValue = "mainnet-beta"
      } else {
        throw new Error("Invalid network selected. Please choose Devnet or Mainnet.")
      }

      // Validate inputs
      if (!creatorPrivateKey || !tokenName || !tokenSymbol || !totalSupply || !decimals) {
        throw new Error("Please fill all required fields")
      }

      const totalSupplyValue = Number.parseInt(totalSupply)
      const decimalsValue = Number.parseInt(decimals)

      if (isNaN(totalSupplyValue) || isNaN(decimalsValue)) {
        throw new Error("Supply and decimals must be valid numbers")
      }
      if (decimalsValue < 0 || decimalsValue > 9) {
        throw new Error("Decimals must be between 0 and 9")
      }

      if (!uploadedIconDataUrl) {
        throw new Error("Please upload an icon image")
      }

      // Validate authority addresses if specified
      if (mintAuthority === "transfer" && !mintAuthorityAddress) {
        throw new Error("Please enter a new mint authority address")
      }
      if (mintAuthority === "transfer" && !isValidSolanaAddress(mintAuthorityAddress)) {
        throw new Error("Invalid mint authority address format")
      }
      if (freezeAuthority === "transfer" && !freezeAuthorityAddress) {
        throw new Error("Please enter a new freeze authority address")
      }
      if (freezeAuthority === "transfer" && !isValidSolanaAddress(freezeAuthorityAddress)) {
        throw new Error("Invalid freeze authority address format")
      }
      if (updateAuthority === "transfer" && !updateAuthorityAddress) {
        throw new Error("Please enter a new update authority address")
      }
      if (updateAuthority === "transfer" && !isValidSolanaAddress(updateAuthorityAddress)) {
        throw new Error("Invalid update authority address format")
      }

      // Decode private key
      let payer
      try {
        payer = web3.Keypair.fromSecretKey(bs58.decode(creatorPrivateKey))
      } catch (error) {
        throw new Error("Invalid private key format. Make sure it's a valid Base58 string.")
      }

      // Establish connection
      let connection = null

      if (customRpcUrl) {
        setStatus("⏳ Connecting to custom RPC...")
        connection = await testConnection(customRpcUrl)
      }

      if (!connection) {
        setStatus(`⏳ Custom RPC failed or not provided, trying public endpoints for ${networkValue}...`)
        for (const endpoint of PUBLIC_RPC_ENDPOINTS[networkValue as keyof typeof PUBLIC_RPC_ENDPOINTS]) {
          connection = await testConnection(endpoint)
          if (connection) break
        }
      }

      if (!connection) {
        throw new Error(
          "All RPC endpoints failed. Please provide a custom RPC URL from a provider like QuickNode, Helius, or Alchemy.",
        )
      }

      // IMPORTANT: Recreate connection with explicit commitment for consistency
      const rpcEndpoint = connection.rpcEndpoint
      connection = new web3.Connection(rpcEndpoint, "confirmed")

      setStatus("⏳ RPC connected! Creating token...")

      addLog(`Using wallet: ${payer.publicKey.toString()}`)

      // Check wallet balance
      const balance = await connection.getBalance(payer.publicKey)
      addLog(`Wallet balance: ${(balance / web3.LAMPORTS_PER_SOL).toFixed(6)} SOL`)

      // Calculate minimum lamports for mint rent exemption
      const minBalanceForMint = await connection.getMinimumBalanceForRentExemption(splToken.MintLayout.span)
      addLog(`Minimum balance for mint rent exemption: ${(minBalanceForMint / web3.LAMPORTS_PER_SOL).toFixed(6)} SOL`)

      // Estimate fees for transactions (approximate)
      const estimatedFeeLamports = 50000 * 5 // 250,000 lamports = 0.00025 SOL approx
      addLog(`Estimated transaction fees: ${(estimatedFeeLamports / web3.LAMPORTS_PER_SOL).toFixed(6)} SOL`)

      // Minimum required balance = rent exemption + estimated fees + small buffer
      const minRequiredBalance = minBalanceForMint + estimatedFeeLamports + 10000 // 10,000 lamports buffer

      if (balance < minRequiredBalance) {
        throw new Error(
          `Wallet balance too low. You need at least ${(minRequiredBalance / web3.LAMPORTS_PER_SOL).toFixed(6)} SOL to create a token. Current balance: ${(balance / web3.LAMPORTS_PER_SOL).toFixed(6)} SOL`,
        )
      }

      // Step 1: Create Mint
      setStatus("⏳ Creating mint account...")
      addLog("Creating mint account...")

      // Determine freeze authority - null if revoking
      let initialFreezeAuthority = null
      if (freezeAuthority === "keep") {
        initialFreezeAuthority = payer.publicKey
      } else if (freezeAuthority === "transfer") {
        initialFreezeAuthority = new web3.PublicKey(freezeAuthorityAddress)
      }

      // Determine mint authority - initially payer, will transfer/revoke later if needed
      const initialMintAuthority = payer.publicKey

      // Create mint account with minimal lamports for rent exemption
      const mint = await splToken.createMint(
        connection,
        payer,
        initialMintAuthority,
        initialFreezeAuthority,
        decimalsValue,
      )

      addLog(`Mint created: ${mint.toString()}`)

      // Step 2: Create token account
      setStatus("⏳ Creating token account...")
      addLog("Creating token account...")

      const ata = await splToken.getOrCreateAssociatedTokenAccount(connection, payer, mint, payer.publicKey)

      addLog(`Token account created: ${ata.address.toString()}`)

      // Step 3: Mint tokens
      setStatus("⏳ Minting tokens...")
      addLog(`Minting ${totalSupplyValue} tokens with ${decimalsValue} decimals...`)

      await splToken.mintTo(
        connection,
        payer,
        mint,
        ata.address,
        payer.publicKey,
        BigInt(totalSupplyValue) * BigInt(10 ** decimalsValue),
      )

      addLog("Tokens minted successfully!")

      // Step 4: Upload metadata and create metadata
      setStatus("⏳ Creating metadata...")
      addLog("Creating metadata...")

      // Create metadata JSON
      const metadata = {
        name: tokenName,
        symbol: tokenSymbol,
        description: description || "",
        image: uploadedIconDataUrl,
        external_url: website || "",
      }

      // Upload to Arweave or create data URI
      const metadataResult = await uploadMetadataToArweave(metadata)
      const metadataUri = metadataResult.url
      addLog(`Metadata created with URI: ${metadataUri.substring(0, 64)}...`)

      // Step 5: Create token metadata
      setStatus("⏳ Creating token metadata on-chain...")
      addLog("Creating token metadata on-chain...")

      // Get metadata PDA
      const { metadataPDA, metadataProgramId } = findMetadataPda(mint)
      addLog(`Metadata PDA: ${metadataPDA.toString()}`)

      // Transactions array
      const transactions = []

      // Create metadata instruction
      try {
        const metadataIx = mplTokenMetadata.createCreateMetadataAccountV3Instruction(
          {
            metadata: metadataPDA,
            mint,
            mintAuthority: payer.publicKey,
            payer: payer.publicKey,
            updateAuthority: payer.publicKey,
          },
          {
            createMetadataAccountArgsV3: {
              data: {
                name: tokenName,
                symbol: tokenSymbol,
                uri: metadataUri,
                sellerFeeBasisPoints: 0,
                creators: null,
                collection: null,
                uses: null,
              },
              isMutable: updateAuthority !== "revoke",
              collectionDetails: null,
            },
          },
        )
        addLog("Created metadata instruction")
        transactions.push(new web3.Transaction().add(metadataIx))
      } catch (err: any) {
        addLog(`Error creating metadata instruction: ${err.message}`)
        throw new Error(`Failed to create metadata instruction: ${err.message}`)
      }

      // Step 6: Handle authority transfers/revoking
      setStatus("⏳ Configuring token authorities...")

      const expectedSettings = {
        revokeMint: mintAuthority === "revoke",
        revokeFreeze: freezeAuthority === "revoke",
        revokeUpdate: updateAuthority === "revoke",
        newMintAuthority: mintAuthority === "transfer" ? mintAuthorityAddress : null,
        newFreezeAuthority: freezeAuthority === "transfer" ? freezeAuthorityAddress : null,
        newUpdateAuthority: updateAuthority === "transfer" ? updateAuthorityAddress : null,
      }

      // Mint authority
      if (mintAuthority === "revoke") {
        addLog("Revoking mint authority (fixed supply)...")
        const revokeMintIx = splToken.createSetAuthorityInstruction(
          mint,
          payer.publicKey,
          splToken.AuthorityType.MintTokens,
          null,
        )
        transactions.push(new web3.Transaction().add(revokeMintIx))
      } else if (mintAuthority === "transfer") {
        addLog(`Transferring mint authority to ${mintAuthorityAddress}...`)
        const newMintAuthority = new web3.PublicKey(mintAuthorityAddress)
        const transferMintIx = splToken.createSetAuthorityInstruction(
          mint,
          payer.publicKey,
          splToken.AuthorityType.MintTokens,
          newMintAuthority,
        )
        transactions.push(new web3.Transaction().add(transferMintIx))
      }

      // Freeze authority (if transfer)
      if (freezeAuthority === "transfer") {
        addLog(`Transferring freeze authority to ${freezeAuthorityAddress}...`)
        const newFreezeAuthority = new web3.PublicKey(freezeAuthorityAddress)
        const transferFreezeIx = splToken.createSetAuthorityInstruction(
          mint,
          payer.publicKey,
          splToken.AuthorityType.FreezeAccount,
          newFreezeAuthority,
        )
        transactions.push(new web3.Transaction().add(transferFreezeIx))
      } else if (freezeAuthority === "revoke") {
        addLog("Revoking freeze authority...")
        const revokeFreezeIx = splToken.createSetAuthorityInstruction(
          mint,
          payer.publicKey,
          splToken.AuthorityType.FreezeAccount,
          null,
        )
        transactions.push(new web3.Transaction().add(revokeFreezeIx))
      }

      // Update authority transfer or revoke
      if (updateAuthority === "transfer" || updateAuthority === "revoke") {
        const newUpdateAuth = updateAuthority === "transfer" ? new web3.PublicKey(updateAuthorityAddress) : null

        addLog(
          updateAuthority === "transfer"
            ? `Transferring update authority to ${updateAuthorityAddress}...`
            : "Revoking update authority (metadata becomes immutable)...",
        )

        try {
          const updateAuthorityIx = mplTokenMetadata.createUpdateMetadataAccountV2Instruction(
            {
              metadata: metadataPDA,
              updateAuthority: payer.publicKey,
            },
            {
              updateMetadataAccountArgsV2: {
                data: null,
                updateAuthority: newUpdateAuth,
                primarySaleHappened: null,
                isMutable: updateAuthority !== "revoke",
              },
            },
          )
          transactions.push(new web3.Transaction().add(updateAuthorityIx))
        } catch (err: any) {
          addLog(`Error creating update authority instruction: ${err.message}`)
          throw new Error(`Failed to create update authority instruction: ${err.message}`)
        }
      }

      // Step 7: Send all transactions
      setStatus("⏳ Finalizing token creation...")
      addLog(`Sending ${transactions.length} transaction${transactions.length !== 1 ? "s" : ""}...`)

      const txIds = []

      for (let i = 0; i < transactions.length; i++) {
        try {
          const tx = transactions[i]
          // Get recent blockhash for the transaction
          const { blockhash } = await connection.getLatestBlockhash()
          tx.recentBlockhash = blockhash
          tx.feePayer = payer.publicKey

          // Sign and send the transaction
          const signedTx = await web3.sendAndConfirmTransaction(connection, tx, [payer])
          txIds.push(signedTx)
          addLog(`Transaction ${i + 1}/${transactions.length} confirmed: ${signedTx}`)
        } catch (err: any) {
          addLog(`Error in transaction ${i + 1}/${transactions.length}: ${err.message}`)
          throw new Error(`Transaction ${i + 1} failed: ${err.message}`)
        }
      }

      // Final status with Solscan link
      const solscanBase = "https://solscan.io/token/"
      const clusterParam = networkValue === "devnet" ? "?cluster=devnet" : ""

      // Set the final result
      setResult({
        mintAddress: mint.toString(),
        name: tokenName,
        symbol: tokenSymbol,
        decimals: decimalsValue,
        supply: totalSupplyValue,
        arweaveUrl: metadataUri,
        network: networkValue,
        solscanUrl: `${solscanBase}${mint.toString()}${clusterParam}`,
        txIds,
        mintAuthority,
        freezeAuthority,
        updateAuthority,
      })

      setStatus("✅ Token created successfully!")
    } catch (error: any) {
      console.error(error)
      addLog(`Error: ${error.message}`)
      setStatus(`❌ Error: ${error.message}`)
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div className="space-y-6">
      <NetworkSelector
        network={network}
        setNetwork={setNetwork}
        customRpcUrl={customRpcUrl}
        setCustomRpcUrl={setCustomRpcUrl}
      />

      <CreatorInfo creatorPrivateKey={creatorPrivateKey} setCreatorPrivateKey={setCreatorPrivateKey} />

      <TokenDetails
        tokenName={tokenName}
        setTokenName={setTokenName}
        tokenSymbol={tokenSymbol}
        setTokenSymbol={setTokenSymbol}
        totalSupply={totalSupply}
        setTotalSupply={setTotalSupply}
        decimals={decimals}
        setDecimals={setDecimals}
        description={description}
        setDescription={setDescription}
        website={website}
        setWebsite={setWebsite}
        uploadedIconDataUrl={uploadedIconDataUrl}
        handleIconUpload={handleIconUpload}
      />

      <AuthoritySettings
        mintAuthority={mintAuthority}
        setMintAuthority={setMintAuthority}
        freezeAuthority={freezeAuthority}
        setFreezeAuthority={setFreezeAuthority}
        updateAuthority={updateAuthority}
        setUpdateAuthority={setUpdateAuthority}
        mintAuthorityAddress={mintAuthorityAddress}
        setMintAuthorityAddress={setMintAuthorityAddress}
        freezeAuthorityAddress={freezeAuthorityAddress}
        setFreezeAuthorityAddress={setFreezeAuthorityAddress}
        updateAuthorityAddress={updateAuthorityAddress}
        setUpdateAuthorityAddress={setUpdateAuthorityAddress}
      />

      <Button
        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3"
        onClick={createToken}
        disabled={isCreating}
      >
        <Coins className="mr-2 h-5 w-5" /> Create Token
      </Button>

      <div className="mt-6 text-center font-semibold text-gray-300">{status}</div>

      {result && (
        <Card className="bg-gray-800 border-gray-700">
          <CardContent className="p-4 space-y-3">
            <h3 className="text-green-400 font-semibold text-lg">✅ Token created successfully!</h3>
            <div className="space-y-2">
              <p>
                <span className="font-medium">Mint Address:</span>{" "}
                <a
                  href={result.solscanUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:underline flex items-center"
                >
                  {result.mintAddress}
                  <ExternalLink className="ml-1 h-3 w-3" />
                </a>
              </p>
              <p>
                <span className="font-medium">Metadata URI:</span>{" "}
                <a
                  href={result.arweaveUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:underline flex items-center"
                >
                  {result.arweaveUrl.length > 60
                    ? `${result.arweaveUrl.substring(0, 30)}...${result.arweaveUrl.substring(result.arweaveUrl.length - 20)}`
                    : result.arweaveUrl}
                  <ExternalLink className="ml-1 h-3 w-3" />
                </a>
              </p>
              <div className="pt-2">
                <strong>Token Details:</strong>
                <p>Name: {result.name}</p>
                <p>Symbol: {result.symbol}</p>
                <p>Decimals: {result.decimals}</p>
                <p>Supply: {result.supply}</p>
                <p>Network: {result.network}</p>
              </div>
              <div className="pt-2">
                <strong>Authority Settings:</strong>
                <p>
                  {result.mintAuthority === "revoke"
                    ? "✅ Mint authority revoked (fixed supply)"
                    : result.mintAuthority === "transfer"
                      ? `✅ Mint authority transferred`
                      : "✅ Mint authority retained by creator"}
                </p>
                <p>
                  {result.freezeAuthority === "revoke"
                    ? "✅ Freeze authority revoked (increased security)"
                    : result.freezeAuthority === "transfer"
                      ? `✅ Freeze authority transferred`
                      : "✅ Freeze authority retained by creator"}
                </p>
                <p>
                  {result.updateAuthority === "revoke"
                    ? "✅ Update authority revoked (metadata immutable)"
                    : result.updateAuthority === "transfer"
                      ? `✅ Update authority transferred`
                      : "✅ Update authority retained by creator"}
                </p>
              </div>
              <div className="pt-2">
                <strong>Transactions:</strong>
                <p>{result.txIds.length} completed</p>
                {result.txIds.map((txId: string, index: number) => (
                  <p key={index}>
                    <a
                      href={`https://solscan.io/tx/${txId}${result.network === "devnet" ? "?cluster=devnet" : ""}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:underline text-sm flex items-center"
                    >
                      Transaction {index + 1}: {txId.slice(0, 8)}...{txId.slice(-8)}
                      <ExternalLink className="ml-1 h-3 w-3" />
                    </a>
                  </p>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <DebugLog logs={logs} />
    </div>
  )
}

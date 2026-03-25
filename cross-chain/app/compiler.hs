{-# LANGUAGE RankNTypes #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE PartialTypeSignatures #-} 
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE KindSignatures, ConstraintKinds #-}

import Prelude

import Cardano.Api
import PlutusTx.Prelude (divide,modulo)
import System.Directory
import System.FilePath.Posix ((</>))
import Plutus.V2.Ledger.Api qualified as Plutus
import CrossChain.GroupNFT ( groupNFTScript, groupNFTScriptShortBs, groupNFTSymbol)
import CrossChain.GroupNFTHolder ( groupNFTHolderScript
  , groupNFTHolderScriptHash
  , groupNFTHolderAddress
  , GroupInfoParams (..)
  , ParamType (..)
  )

import CrossChain.InboundMintCheck
  ( inboundMintCheckScript
  ,inboundMintCheckScriptHash
  ,inboundMintCheckAddress
  )

import CrossChain.OutboundToken
  ( outboundTokenScript
  ,outboundTokenCurSymbol
  ,outboundTokenScriptShortBs
  ,OutboundTokenParams (..)
  )

import Plutus.V2.Ledger.Contexts as V2
import Plutus.V2.Ledger.Tx as V2
import Ledger.Address 
import Crypto.Secp256k1 qualified as SECP
import Data.ByteString.Hash (blake2b_256,sha3_256)
import Cardano.Crypto.DSIGN.EcdsaSecp256k1 qualified as EcdsaSecp256k1
import Data.ByteString.Base16 qualified as Base16
import Data.ByteString.Char8 qualified as Char8
import Data.ByteString (ByteString)
import Data.ByteString qualified as ByteString
import Data.Kind (Type)
import Cardano.Crypto.Seed (mkSeedFromBytes)
import Cardano.Crypto.DSIGN.Class (
  DSIGNAlgorithm,
  SignKeyDSIGN,
  deriveVerKeyDSIGN,
  genKeyDSIGN,
  rawSerialiseSigDSIGN,
  rawSerialiseVerKeyDSIGN,
  rawSerialiseSignKeyDSIGN,
  signDSIGN,
 )

import CrossChain.CheckToken
  ( checkTokenScript
  , checkTokenScriptShortBs
  , checkTokenCurrency
  , CheckTokenParam (..)
  )

import CrossChain.AdminNFTHolder
  ( adminNFTHolderScript
  , adminNFTHolderScriptHash
  , adminNFTHolderAddress
  , AdminActionRedeemer (..)
  )

import CrossChain.StoremanStake
  ( storemanStakeScript
  , storemanStakeScriptShortBs
  , storemanStakeHash
  )

import CrossChain.StakeCheck
  ( stakeCheckScript
  ,stakeCheckScriptHash
  ,stakeCheckAddress
  ,StakeCheckRedeemer (..)
  )

import CrossChain.XPort
  ( xPortScript
  ,xPortScriptHash
  ,xPortAddress
  ,KeyParam (..)
  )
  
import CrossChain.InboundToken
  ( inboundTokenScript
  , inboundTokenScriptShortBs
  , inboundTokenCurSymbol
  )

import PlutusTx.Builtins qualified as Builtins
import Data.Maybe (fromMaybe)
import PlutusTx qualified
import Plutus.V2.Ledger.Api (ToData, toData,fromData,ValidatorHash (..), PubKeyHash (..),BuiltinByteString (..), Credential (..), StakingCredential (..),ToData (toBuiltinData), DatumHash (..),Datum (..))
import Cardano.Api.Shelley (fromPlutusData)
import Cardano.Crypto.DSIGN.SchnorrSecp256k1 qualified as SchnorrSecp256k1

import Cardano.Crypto.DSIGN.Ed25519 qualified as Ed25519
import Ledger.Crypto (PubKey (..), PubKeyHash, pubKeyHash,pubKeyHash)
import Plutus.V1.Ledger.Bytes (LedgerBytes (LedgerBytes),fromBytes,getLedgerBytes)
import Plutus.V1.Ledger.Value
import CrossChain.Types


toBS :: String -> ByteString
toBS = ByteString.pack . map (fromIntegral . fromEnum)


skey :: forall (a :: Type). (DSIGNAlgorithm a) => SignKeyDSIGN a
skey = genKeyDSIGN $ mkSeedFromBytes $ ByteString.pack [0xcb,0xc6,0x23,0x25,0x4c,0xa1,0xeb,0x30,0xd8,0xcb,0x21,0xb2,0xef,0x04,0x38,0x13,0x72,0xff,0x24,0x52,0x9a,0x74,0xe4,0xb5,0x11,0x7d,0x1e,0x3b,0xbb,0x0f,0x01,0x88]

vkey :: forall (a :: Type). (DSIGNAlgorithm a) => EcdsaSecp256k1.VerKeyDSIGN a
vkey = deriveVerKeyDSIGN skey

vkeySchnorr :: forall (a :: Type). (DSIGNAlgorithm a) => SchnorrSecp256k1.VerKeyDSIGN a
vkeySchnorr = deriveVerKeyDSIGN skey

vkeyEd25519 :: forall (a :: Type). (DSIGNAlgorithm a) => Ed25519.VerKeyDSIGN a
vkeyEd25519 = deriveVerKeyDSIGN skey

pkh :: LedgerBytes
pkh = fromBytes $ ByteString.pack [0x72,0xeb,0xc8,0x49,0x8c,0xe1,0x73,0x91,0x6e,0x5d,0x81,0x97,0x25,0xf3,0x3d,0xac,0x49,0x9a,0x0c,0xe9,0xf5,0xe8,0x2f,0x2d,0xce,0xf8,0x88,0x76]

byteToBuiltinByteString :: [Integer] -> BuiltinByteString -> BuiltinByteString
byteToBuiltinByteString [] _ =  ""
byteToBuiltinByteString [x] s =  Builtins.consByteString x s
byteToBuiltinByteString (x:xs) s = Builtins.consByteString x (byteToBuiltinByteString xs s)



burnAdminPKh :: PubKeyHash
burnAdminPKh = 
  let a = [0x72,0xeb,0xc8,0x49,0x8c,0xe1,0x73,0x91,0x6e,0x5d,0x81,0x97,0x25,0xf3,0x3d,0xac,0x49,0x9a,0x0c,0xe9,0xf5,0xe8,0x2f,0x2d,0xce,0xf8,0x88,0x76] 
  in PubKeyHash (byteToBuiltinByteString a Builtins.emptyByteString)

targetPKh :: PubKeyHash
targetPKh = 
  let a = [0x33,0x0b,0x94,0x83,0x6a,0x6a,0x8b,0xbb,0x74,0x09,0xf7,0xc7,0x73,0xa1,0x62,0x1c,0x63,0x5a,0xa4,0x77,0x4b,0xb1,0x22,0xd9,0x53,0x10,0x5d,0xb2] 
  in PubKeyHash (byteToBuiltinByteString a Builtins.emptyByteString)

vhbs :: LedgerBytes
vhbs = fromBytes $ ByteString.pack [0x96,0x29,0x2c,0x2c,0x1c,0x12,0xf5,0x77,0x19,0xf8,0x2c,0xa6,0x8e,0x25,0xe1,0x3a,0xa3,0xfb,0xe2,0x8a,0xd9,0xf9,0x0,0xec,0xda,0x27,0x90,0x9]

vh :: ValidatorHash
vh = ValidatorHash (getLedgerBytes vhbs)


byteStringToBuildByteString :: ByteString -> BuiltinByteString
byteStringToBuildByteString = getLedgerBytes . fromBytes

main :: IO ()
main = do
  let v2dir = "generated-plutus-scripts/v2"
      datadir = "data"
      id1_arr = [0x2c,0x57,0x47,0xa7,0x49,0xd5,0xc7,0x4b,0xfe,0xdc,0x30,0xc8,0x7b,0x5d,0xb4,0x7c,0x37,0x24,0xad,0x09,0x0b,0x94,0x79,0x5f,0xe1,0xa6,0x84,0x3c,0xfc,0x0e,0xb7,0x73]
      id2_arr = [0xa9,0x39,0xfc,0x61,0x55,0xa2,0xaa,0x26,0x5d,0xe4,0x56,0xc9,0xeb,0x48,0x56,0x2c,0x21,0x2d,0x6b,0x1c,0x49,0x34,0x6d,0x49,0x1a,0xcc,0xc6,0xa0,0x00,0xe6,0x9d,0x4a]
      oldTreasuryV = [0x1d,0x92,0x61,0x9d,0xfd,0x0e,0x63,0x8c,0x96,0xe1,0xe2,0x75,0xc8,0x04,0x0a,0x24,0x24,0xc2,0x2b,0xa8,0x25,0x27,0x85,0xd2,0xe6,0x82,0x34,0x6e]
      oldTreasuryCheckTokenSymbolBytes = [0x42,0x95,0x91,0x4e,0xf5,0xff,0x86,0x20,0x46,0x42,0xd3,0x33,0x4e,0xe4,0x44,0xf9,0xda,0xfc,0x69,0x4b,0x4d,0xa2,0x46,0xb3,0x9b,0x68,0xfb,0xb0]
      oldMintCheckTokenSymbolBytes     = [0x27,0x07,0xef,0x39,0xe2,0x52,0x11,0x17,0xd2,0xd3,0x85,0x1e,0xf8,0x0a,0xd1,0x77,0x37,0xeb,0x82,0x94,0xa5,0x83,0x97,0x94,0x8a,0xa2,0x85,0x68]

      oldTreasuryVH = ValidatorHash (getLedgerBytes $ fromBytes $ ByteString.pack oldTreasuryV)

      id = getLedgerBytes $ fromBytes $ ByteString.pack id1_arr
      txId = V2.TxId id
      index = 0;
      utxoRef = V2.TxOutRef txId index

      id2 = getLedgerBytes $ fromBytes $ ByteString.pack id2_arr
      txId2 = V2.TxId id2
      index2 = 0;
      utxoRef2 = V2.TxOutRef txId2 index2

      amount =   100000000
      adaAmount = 11000000
      
      to :: BuiltinByteString
      to = getLedgerBytes $ fromBytes $ ByteString.pack [0xb4,0xb7,0x58,0x48,0x84,0x3d,0x48,0x5a,0x3e,0x2f,0x1f,0x95,0x78,0x37,0x63,0xaf,0xb5,0x80,0x09,0xe5,0xff,0x44,0x4c,0xde,0x1d,0xfd,0x3e,0x19]

      policy :: BuiltinByteString
      policy = getLedgerBytes $ fromBytes $ ByteString.pack [0xd7,0x33,0xad,0x46,0x71,0x1b,0x8d,0xf3,0xdb,0x5c,0x8e,0x5e,0xd8,0x52,0x7c,0xe8,0xde,0xc9,0xca,0x2c,0xd1,0x97,0x75,0xb5,0xd9,0x56,0x75,0x6b]

      assetName :: BuiltinByteString
      assetName = getLedgerBytes $ fromBytes $ ByteString.pack [0x61,0x62,0x63]

      assetNameT :: BuiltinByteString
      assetNameT = getLedgerBytes $ fromBytes $ ByteString.pack [0x63,0x62,0x61]

      groupNftSymbol = groupNFTSymbol utxoRef
      groupNftName = TokenName (Builtins.encodeUtf8 "GroupInfoTokenCoin")
      groupNft = GroupNFTTokenInfo groupNftSymbol groupNftName

      adminNFTSymbol = groupNFTSymbol utxoRef2
      adminNFTName = TokenName (Builtins.encodeUtf8 "AdminNFTCoin")
      adminNft = AdminNftTokenInfo adminNFTSymbol adminNFTName

      treasuryCheckTokenName = TokenName (Builtins.encodeUtf8 "TCheckCoin")
      treasuryCheckTokenParam = CheckTokenParam groupNft adminNft treasuryCheckTokenName TreasuryCheckVH
      treasuryCheckTokenSymbol = CurrencySymbol (getLedgerBytes $ fromBytes $ ByteString.pack oldTreasuryCheckTokenSymbolBytes)
      
      treasuryCheckToken = CheckTokenInfo treasuryCheckTokenSymbol treasuryCheckTokenName

      mintCheckTokenName = TokenName (Builtins.encodeUtf8 "MCheckCoin")
      mintCheckTokenParam = CheckTokenParam groupNft adminNft mintCheckTokenName MintCheckVH
      mintCheckTokenSymbol = CurrencySymbol (getLedgerBytes $ fromBytes $ ByteString.pack oldMintCheckTokenSymbolBytes)
      mintCheckToken = CheckTokenInfo mintCheckTokenSymbol mintCheckTokenName

      ---------------------------------------------------------------------------
      nftTreasuryCheckTokenName = TokenName (Builtins.encodeUtf8 "NFTTCheckCoin")
      nftTreasuryCheckTokenParam = CheckTokenParam groupNft adminNft nftTreasuryCheckTokenName NFTTreasuryCheckVH
      nftTreasuryCheckTokenSymbol = checkTokenCurrency nftTreasuryCheckTokenParam
      nftTreasuryCheckToken = CheckTokenInfo nftTreasuryCheckTokenSymbol nftTreasuryCheckTokenName

      nftMintCheckTokenName = TokenName (Builtins.encodeUtf8 "NFTMCheckCoin")
      nftMintCheckTokenParam = CheckTokenParam groupNft adminNft nftMintCheckTokenName NFTMintCheckVH
      nftMintCheckTokenSymbol = checkTokenCurrency nftMintCheckTokenParam
      nftMintCheckToken = CheckTokenInfo nftMintCheckTokenSymbol nftMintCheckTokenName
      ---------------------------------msg cross-chain---------------------------------------------
      inboundMintCheckTokenName = TokenName (Builtins.encodeUtf8 "InboundCheckCoin")
      inboundMintCheckTokenParam = CheckTokenParam groupNft adminNft inboundMintCheckTokenName InboundCheckVH
      inboundMintCheckTokenSymbol = checkTokenCurrency inboundMintCheckTokenParam
      inboundMintCheckToken = CheckTokenInfo inboundMintCheckTokenSymbol inboundMintCheckTokenName


      unique = getLedgerBytes $ fromBytes $ ByteString.pack [0xd7,0x34,0xaf,0x46,0x71,0x1b,0x8d,0xf3,0xdb,0x5c,0x8e,0x5e,0xd8,0x52,0x7c,0xe8,0xde,0xc9,0xca,0x23]
      unique2 = getLedgerBytes $ fromBytes $ ByteString.pack [0xd2,0x34,0xaf,0x46,0x71,0x1b,0x8d,0xf3,0xdb,0x5c,0x8e,0x5e,0xd8,0x52,0x7c,0xe8,0xde,0xc9,0xca,0x23]
      ---------------------------------------------------------------------------

      groupAdminNFTInfo = GroupAdminNFTInfo groupNft adminNft


      groupTokenInfo = GroupInfoParams [(unCurrencySymbol  groupNftSymbol),(unTokenName groupNftName)]

      mintCheckParam = GroupAdminNFTCheckTokenInfo groupNft adminNft mintCheckToken

-------------------------- msg cross-chain  -------------------------------- 
      inboundTokenSymbol = inboundTokenCurSymbol inboundMintCheckToken
      inboundMintCheckParam = InboundMintCheckInfo (GroupAdminNFTCheckTokenInfo groupNft adminNft inboundMintCheckToken) inboundTokenSymbol -- inboundTokenName
      
      outboundTokenName = TokenName (Builtins.encodeUtf8 "OutboundTokenCoin")
      outboundTokenParam = OutboundTokenParams groupNft outboundTokenName

      outboundTokenSymbol = outboundTokenCurSymbol outboundTokenParam

----------------------------------------------------------------------------------
      tokenName = byteToBuiltinByteString [0x61,0x62,0x63] Builtins.emptyByteString

      tmp = Builtins.appendByteString (Builtins.appendByteString (Builtins.appendByteString (Builtins.appendByteString to policy) assetName) (packInteger amount )) (packInteger adaAmount)
      originData = Builtins.appendByteString (Builtins.appendByteString tmp (V2.getTxId $ V2.txOutRefId utxoRef)) (packInteger (V2.txOutRefIdx utxoRef))
      dataHash = sha3_256 $ Builtins.fromBuiltin originData

      
      ----------------------------------------------------------------
      rawMsg = Char8.pack "abc"
      msgB = Builtins.toBuiltin rawMsg
      hashedMsg = sha3_256 rawMsg

      ecdsaMsg = fromMaybe undefined $ SECP.msg hashedMsg

      ecdsaSig :: EcdsaSecp256k1.SigDSIGN EcdsaSecp256k1.EcdsaSecp256k1DSIGN
      ecdsaSig = signDSIGN () ecdsaMsg skey

      skey' = rawSerialiseSignKeyDSIGN @EcdsaSecp256k1.EcdsaSecp256k1DSIGN skey

      msg = Builtins.toBuiltin hashedMsg

      vkeyB' = rawSerialiseVerKeyDSIGN @SchnorrSecp256k1.SchnorrSecp256k1DSIGN vkeySchnorr
      pkB = Builtins.toBuiltin vkeyB'

      pkBh = pubKeyHash (PubKey (LedgerBytes pkB))

      

      vkey' = rawSerialiseVerKeyDSIGN @EcdsaSecp256k1.EcdsaSecp256k1DSIGN vkey
      pk = Builtins.toBuiltin vkey'

      schnorrSig :: SchnorrSecp256k1.SigDSIGN SchnorrSecp256k1.SchnorrSecp256k1DSIGN
      schnorrSig = signDSIGN () rawMsg skey

      ed25519Sig :: Ed25519.SigDSIGN Ed25519.Ed25519DSIGN
      ed25519Sig = signDSIGN () dataHash skey

      vkeyBEd25519' = rawSerialiseVerKeyDSIGN @Ed25519.Ed25519DSIGN vkeyEd25519
      pkEd25519 = Builtins.toBuiltin vkeyBEd25519'

      sigC = rawSerialiseSigDSIGN ed25519Sig
      sigC' = Builtins.toBuiltin sigC

      sigB = rawSerialiseSigDSIGN schnorrSig
      sigB' = Builtins.toBuiltin sigB

      sig = rawSerialiseSigDSIGN ecdsaSig
      sig' = Builtins.toBuiltin sig 

      datum = AdminDatum [(getPubKeyHash burnAdminPKh),(getPubKeyHash targetPKh)] 1

      vv = Plutus.singleton Plutus.adaSymbol Plutus.adaToken 123456789 <> Plutus.singleton (CurrencySymbol policy) (TokenName assetName) 333333 <> Plutus.singleton (CurrencySymbol policy) (TokenName assetNameT) 22222

      

      hashRedeemer :: BuiltinByteString
      hashRedeemer = 
        let tmp = Builtins.appendByteString (Builtins.appendByteString (Builtins.appendByteString (Builtins.appendByteString to policy) assetName) (packInteger amount)) (packInteger adaAmount)
            tmp2 = Builtins.appendByteString (Builtins.appendByteString tmp (V2.getTxId $ txOutRefId utxoRef)) (packInteger (txOutRefIdx utxoRef))
            tmp3 = Builtins.appendByteString tmp2 (packInteger 0)
        in Builtins.sha3_256 tmp3

      (Address (ScriptCredential s) _) = groupNFTHolderAddress groupAdminNFTInfo

      testAddress = Address (ScriptCredential vh) Nothing --(Just (StakingHash (ScriptCredential vh))) 
      testAddress2 = Address (ScriptCredential vh) (Just (StakingHash (PubKeyCredential burnAdminPKh))) 
      testAddress3 = Address (ScriptCredential vh) (Just (StakingHash (ScriptCredential vh))) 

      testOutputDatum = NoOutputDatum

      testOutputDatum2 = OutputDatumHash (DatumHash id)

      testOutputDatum3 = OutputDatum (Datum $ PlutusTx.toBuiltinData datum)

      nftAssets = [(assetName,2),(assetNameT,45)]
      nftRefAssets = [(0,assetName,testOutputDatum3),(1,assetNameT,testOutputDatum3)]

      nftTreasuryCheckProof = NFTTreasuryCheckRedeemer (NFTTreasuryCheckProof (NFTTreasuryCheckProofData id utxoRef 1 testAddress2 policy vv testOutputDatum3 2 321 ) to)

      nftMintCheckProof = NFTMintCheckRedeemer (NFTMintCheckProof (NFTMintCheckProofData id utxoRef 1 testAddress2 policy nftAssets testOutputDatum3 nftRefAssets 321 ) to)

  createDirectoryIfMissing True v2dir
  createDirectoryIfMissing True datadir

  putStrLn $ "utxoRef: " ++ (Char8.unpack (Base16.encode $ Builtins.fromBuiltin (Builtins.serialiseData $ toBuiltinData utxoRef)))

  putStrLn "---------------"
  putStrLn $ "GroupInfoTokenCoin: " ++ (Char8.unpack (Base16.encode $ Builtins.fromBuiltin $ Builtins.encodeUtf8 "GroupInfoTokenCoin"))
  putStrLn $ "dataHash: " ++ (Char8.unpack (Base16.encode  dataHash))
  putStrLn $ "originData: " ++ (Char8.unpack (Base16.encode $ Builtins.fromBuiltin originData))
  putStrLn $ "redeemerHash: " ++ (Char8.unpack (Base16.encode $ Builtins.fromBuiltin hashRedeemer))

  _ <- writeFileTextEnvelope (v2dir </> "inbound-token.plutus") Nothing (inboundTokenScript inboundMintCheckToken)
  _ <- writeFileTextEnvelope (v2dir </> "inbound-check-token.plutus") Nothing (checkTokenScript inboundMintCheckTokenParam)
  _ <- writeFileTextEnvelope (v2dir </> "inbound-check.plutus") Nothing (inboundMintCheckScript inboundMintCheckParam)
  _ <- writeFileTextEnvelope (v2dir </> "outbound-token.plutus") Nothing (outboundTokenScript outboundTokenParam)
  _ <- writeFileTextEnvelope (v2dir </> "outbound-holder.plutus") Nothing (xPortScript (KeyParam burnAdminPKh 1))

  return ()


writeRedeemer :: forall (a :: Type). ToData a => FilePath -> a -> IO ((Either (FileError ()) ()))
writeRedeemer path =
  writeFileJSON path
    . scriptDataToJson ScriptDataJsonDetailedSchema
    . fromPlutusData
    . PlutusTx.toData 

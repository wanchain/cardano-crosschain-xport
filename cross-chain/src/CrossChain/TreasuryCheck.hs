{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE NoImplicitPrelude #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeApplications      #-}
{-# LANGUAGE TypeFamilies       #-}
{-# LANGUAGE RankNTypes            #-}
{-# LANGUAGE NamedFieldPuns       #-}
{-# LANGUAGE DerivingStrategies #-}
{-# LANGUAGE DeriveAnyClass     #-}
{-# LANGUAGE DeriveGeneric      #-}
{-# LANGUAGE ScopedTypeVariables  #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE ViewPatterns         #-}
-- {-# LANGUAGE FlexibleContexts   #-}
-- {-# LANGUAGE NamedFieldPuns     #-}
-- {-# LANGUAGE OverloadedStrings  #-}
-- {-# LANGUAGE TypeOperators      #-}
-- {-# OPTIONS_GHC -fno-ignore-interface-pragmas #-}
-- {-# OPTIONS_GHC -fno-specialise #-}
{-# OPTIONS_GHC -fplugin-opt PlutusTx.Plugin:profile-all #-}
{-# OPTIONS_GHC -fplugin-opt PlutusTx.Plugin:dump-uplc #-}

module CrossChain.TreasuryCheck
  ( treasuryCheckScript
  -- , authorityCheckScriptShortBs
  ,treasuryCheckScriptHash
  -- ,authorityCheckScriptHashStr
  ,treasuryCheckAddress
  , TreasuryCheckProof (..)
  -- ,TreasuryCheckProof
  , TreasuryCheckRedeemer(..)
  ,TreasuryCheckParams (..)
  ,TreasuryCheckParams
  ) where

import Data.Aeson (FromJSON, ToJSON)
import GHC.Generics (Generic)
import Cardano.Api.Shelley (PlutusScript (..), PlutusScriptV2)
import Prelude hiding (($),(<>), (&&), (==),(||),(>=),(<=),(<),(-),(/=),not,length,filter,(>),(+),map,any,elem,fst,snd,mconcat)

import Codec.Serialise
import Data.ByteString.Lazy qualified as LBS
import Data.ByteString.Short qualified as SBS

-- import Plutus.Script.Utils.V2.Typed.Scripts.Validators as Scripts
import Plutus.Script.Utils.V2.Typed.Scripts qualified as PV2
import Plutus.Script.Utils.V2.Scripts as Scripts
import Plutus.V2.Ledger.Api qualified as Plutus
import Plutus.V2.Ledger.Contexts as V2
import PlutusTx qualified
-- import PlutusTx.Builtins
import PlutusTx.Builtins
-- import PlutusTx.Eq as PlutusTx
-- import PlutusTx.Eq()
import PlutusTx.Prelude hiding (SemigroupInfo (..), (.))--unless
-- import PlutusTx.Prelude qualified as PlutusPrelude
import           Ledger               hiding (validatorHash)
import Plutus.V2.Ledger.Tx (OutputDatum (..)) -- isPayToScriptOut
import Ledger.Typed.Scripts (ValidatorTypes (..), TypedValidator (..),mkTypedValidatorParam) --mkTypedValidator,mkUntypedValidator )
-- import Plutus.Script.Utils.Typed (validatorScript,validatorAddress,validatorHash)

-- import Data.ByteString qualified as ByteString
import Ledger.Crypto (PubKey (..), PubKeyHash)--, pubKeyHash
-- import Plutus.V1.Ledger.Bytes (LedgerBytes (LedgerBytes),fromBytes,getLedgerBytes)
import Ledger.Ada  as Ada
import Plutus.V1.Ledger.Value (valueOf,flattenValue)--,currencySymbol,tokenName,symbols,)
import PlutusTx.Builtins --(decodeUtf8,sha3_256,appendByteString)
import Ledger.Address 
import Ledger.Value
import Plutus.V2.Ledger.Contexts as V2
import Ledger.Typed.Scripts qualified as Scripts hiding (validatorHash)
import Plutus.V1.Ledger.Tx
import CrossChain.Types 
-- ===================================================
-- import Plutus.V1.Ledger.Value
-- import Ledger.Address (PaymentPrivateKey (PaymentPrivateKey, unPaymentPrivateKey), PaymentPubKey (PaymentPubKey),PaymentPubKeyHash (..),unPaymentPubKeyHash,toPubKeyHash,toValidatorHash)

import Ledger hiding (validatorHash) --singleton




data TreasuryCheckProof = TreasuryCheckProof
  {
    toPkhPay :: BuiltinByteString -- send toPkh 
    , toPkhStk :: BuiltinByteString
    , policy :: BuiltinByteString -- which token , zero indicated only transfer ada
    , assetName :: BuiltinByteString
    , amount :: Integer  -- token amount
    , adaAmount :: Integer -- addtional ada amount
    , txHash :: BuiltinByteString
    , index :: Integer
    , mode :: Integer
    , uniqueId :: BuiltinByteString
    , txType :: Integer
    , ttl :: Integer
    , outputCount :: Integer
    , signature :: BuiltinByteString
  }deriving (Prelude.Eq, Show)


PlutusTx.unstableMakeIsData ''TreasuryCheckProof
PlutusTx.makeLift ''TreasuryCheckProof


data TreasuryCheckProof2 = TreasuryCheckProof2
  {
    proofPart :: TreasuryCheckProof
    , userData2 :: BuiltinByteString
  }deriving (Prelude.Eq, Show)


PlutusTx.unstableMakeIsData ''TreasuryCheckProof2
PlutusTx.makeLift ''TreasuryCheckProof2

data TreasuryCheckRedeemer = BurnTreasuryCheckToken | TreasuryCheckRedeemer TreasuryCheckProof | TreasuryCheckRedeemer2 TreasuryCheckProof2
    deriving (Show, Prelude.Eq)
PlutusTx.unstableMakeIsData ''TreasuryCheckRedeemer

data TreasuryType
instance Scripts.ValidatorTypes TreasuryType where
    type instance DatumType TreasuryType = ()
    type instance RedeemerType TreasuryType = TreasuryCheckRedeemer

data TreasuryCheckParams
  = TreasuryCheckParams
      { tokenInfos :: GroupAdminNFTCheckTokenInfo
        , treasury :: ValidatorHash 
      } deriving (Generic, Prelude.Eq)
        -- deriving anyclass (ToJSON, FromJSON)

PlutusTx.unstableMakeIsData ''TreasuryCheckParams
PlutusTx.makeLift ''TreasuryCheckParams


{-# INLINABLE isExpectedValue #-}
isExpectedValue :: Value -> CurrencySymbol -> TokenName -> Bool
isExpectedValue v cs tk = 
  if cs == Ada.adaSymbol && tk == Ada.adaToken then v == Plutus.singleton Plutus.adaSymbol Plutus.adaToken assetAmount
  else (v == ((Plutus.singleton Plutus.adaSymbol Plutus.adaToken (valueOf v Ada.adaSymbol Ada.adaToken)) <> Plutus.singleton cs tk assetAmount)) 
  && (assetAmount > 0)
  where
    assetAmount = valueOf v cs tk

{-# INLINABLE isMultiAsset #-}
isMultiAsset :: Value ->Bool
isMultiAsset v = (length $ flattenValue v) > 2

{-# INLINABLE verify #-}
verify :: Integer -> BuiltinByteString -> BuiltinByteString -> BuiltinByteString-> Bool
verify mode pk hash signature
  | mode == 0 = verifyEcdsaSecp256k1Signature pk hash signature
  | mode == 1 = verifySchnorrSecp256k1Signature pk hash signature
  | mode == 2 = verifyEd25519Signature pk hash signature
  -- | otherwise = traceError "m"


{-# INLINABLE hasUTxO #-}
hasUTxO :: V2.ScriptContext -> BuiltinByteString -> Integer -> Bool
hasUTxO V2.ScriptContext{V2.scriptContextPurpose=Spending txOutRef} txHash index = (V2.txOutRefId txOutRef) == (Plutus.TxId txHash) && (V2.txOutRefIdx txOutRef) == index


{-# INLINABLE isValidValue #-}
isValidValue :: Value -> Integer -> CurrencySymbol -> TokenName -> Bool
isValidValue v txType targetSymbol targetTokenName--v = isExpectedValue v targetSymbol targetTokenName
  | txType == 2 = isMultiAsset v
  | otherwise = isExpectedValue v targetSymbol targetTokenName
  

{-# INLINABLE treasuryInputValue #-}
treasuryInputValue :: V2.TxInfo -> ValidatorHash -> Integer -> CurrencySymbol -> TokenName ->Value
treasuryInputValue info treasury txType symbol name = go (Plutus.singleton Plutus.adaSymbol Plutus.adaToken 0) (V2.txInfoInputs info)
  where
    go v [] = v
    go v (V2.TxInInfo{V2.txInInfoResolved=V2.TxOut{V2.txOutValue,V2.txOutAddress}} : rest) = case txOutAddress of
      Address{addressCredential} -> case addressCredential of
        Plutus.ScriptCredential s -> 
          if s == treasury then 
            if isValidValue txOutValue txType symbol name then go (v <> txOutValue) rest
            else traceError ""
          else go v rest
        _ -> go v rest


{-# INLINABLE burnTokenCheck #-}
burnTokenCheck :: TreasuryCheckParams -> V2.ScriptContext -> Bool
burnTokenCheck (TreasuryCheckParams (GroupAdminNFTCheckTokenInfo _ (AdminNftTokenInfo adminNftSymbol adminNftName) (CheckTokenInfo checkTokenSymbol checkTokenName)) treasury) ctx = 
  traceIfFalse "" ( ((valueOf (V2.valueSpent (V2.scriptContextTxInfo ctx)) adminNftSymbol adminNftName)  == 1)
  && ((valueOf (V2.valueProduced (V2.scriptContextTxInfo ctx)) checkTokenSymbol checkTokenName) == 0)
  && ((valueOf (treasuryInputValue (V2.scriptContextTxInfo ctx) treasury 2 Ada.adaSymbol Ada.adaToken) Ada.adaSymbol Ada.adaToken) <= 0) ) --(not hasTreasuryInput)
  -- where 
  --   info :: V2.TxInfo
  --   !info = V2.scriptContextTxInfo ctx

  --   -- groupInfo :: GroupInfoParams
  --   -- !groupInfo = getGroupInfo info groupInfoCurrency groupInfoTokenName

  --   hasAdminNftInInput :: Bool
  --   !hasAdminNftInInput = 
  --     let !totalInputValue = V2.valueSpent info
  --         !amount = valueOf totalInputValue adminNftSymbol adminNftName
  --     in amount == 1

  --   -- checkOutPut :: Bool
  --   -- !checkOutPut = 
  --   --   let outputValue = V2.valueProduced info
  --   --   in valueOf outputValue checkTokenSymbol checkTokenName == 0
 
{-# INLINABLE treasurySpendCheckA #-}
treasurySpendCheckA :: TreasuryCheckParams -> TreasuryCheckProof -> BuiltinByteString -> V2.ScriptContext -> Bool
treasurySpendCheckA (TreasuryCheckParams (GroupAdminNFTCheckTokenInfo (GroupNFTTokenInfo groupInfoCurrency groupInfoTokenName) (AdminNftTokenInfo adminNftSymbol adminNftName) (CheckTokenInfo checkTokenSymbol checkTokenName)) treasury) (TreasuryCheckProof toPkhPay toPkhStk policy assetName amount adaAmount txHash index mode uniqueId txType ttl outputCount signature) userData ctx = 
  traceIfFalse "1" ((hasUTxO ctx txHash index) && (amountOfCheckTokeninOwnOutput == 1)) &&
  traceIfFalse "3" (hasTreasuryInput  && checkTxInOut) &&
  traceIfFalse "4" (checkTtl && checkSignature)
  -- traceIfFalse "5" checkSignature -- && 
  -- traceIfFalse "6" checkTxInOut -- &&
  -- traceIfFalse "7" (userData /= emptyByteString || txType == 0)
  where
    info :: V2.TxInfo
    !info = V2.scriptContextTxInfo ctx

    hashRedeemer :: BuiltinByteString
    !hashRedeemer = sha3_256 $ mconcat [toPkhPay,toPkhStk,policy,assetName,(packInteger amount),(packInteger adaAmount),txHash,(packInteger index),(packInteger mode),uniqueId,(packInteger txType),(packInteger ttl),(packInteger outputCount),userData]

    groupInfo :: GroupInfoParams
    !groupInfo = getGroupInfo info groupInfoCurrency groupInfoTokenName

    stkVh :: BuiltinByteString
    !stkVh = getGroupInfoParams groupInfo StkVh

    amountOfCheckTokeninOwnOutput :: Integer
    !amountOfCheckTokeninOwnOutput = getAmountOfCheckTokeninOwnOutput ctx checkTokenSymbol checkTokenName stkVh

    checkSignature :: Bool
    !checkSignature = 
      let !groupInfoPk = getGroupInfoParams groupInfo GPK
      in verify mode groupInfoPk hashRedeemer signature

    hasTreasuryInput :: Bool
    !hasTreasuryInput = ((valueOf totalTreasurySpendValue Ada.adaSymbol Ada.adaToken) > 0)

    targetSymbol :: CurrencySymbol 
    !targetSymbol = CurrencySymbol policy
    
    targetTokenName :: TokenName
    !targetTokenName = TokenName assetName

    totalTreasurySpendValue :: Value
    !totalTreasurySpendValue= treasuryInputValue info treasury txType targetSymbol targetTokenName 

    checkTxInOut:: Bool
    !checkTxInOut  
      | txType == 0 = checkTx 
      | txType == 1 = ((ValidatorHash toPkhPay) == treasury ) && (toPkhStk == stkVh) && checkTx
      | txType == 2 = (valuePaidTo' info (PubKeyHash toPkhPay) toPkhStk ) `geq` totalTreasurySpendValue --treasuryInputValue



    crossValue :: Value
    !crossValue
      | (txType == 0) = Ada.lovelaceValueOf adaAmount <> Plutus.singleton targetSymbol targetTokenName amount
      | otherwise = Ada.lovelaceValueOf 0

    valuePaidToTarget :: Value
    !valuePaidToTarget 
      | txType == 1 = valueLockedBy' info treasury stkVh
      | otherwise = valuePaidTo' info (PubKeyHash toPkhPay) toPkhStk
    
    receivedValue :: Value
    !receivedValue
      | userData == emptyByteString = valuePaidToTarget
      | otherwise = valueLockedByAndCheckDatum info (ValidatorHash toPkhPay) toPkhStk userData


    checkTx :: Bool 
    !checkTx = 
        let !changeValues = map snd $ scriptOutputsAt' treasury stkVh info True
            !remainValue = mconcat changeValues
            !valueSum = crossValue <> remainValue
        in 
          (receivedValue `geq` crossValue) 
          && (valueSum `geq` totalTreasurySpendValue) 
          && (length changeValues == outputCount) 
          && (isSingleAsset receivedValue targetSymbol targetTokenName)
          && (isSingleAsset remainValue targetSymbol targetTokenName)

    checkTtl :: Bool
    !checkTtl = 
      let !range = V2.txInfoValidRange info
      in  (Plutus.POSIXTime (ttl + 1)) `after` range


{-# INLINABLE mkValidator #-}
mkValidator :: TreasuryCheckParams ->() -> TreasuryCheckRedeemer -> V2.ScriptContext -> Bool
mkValidator storeman _ redeemer ctx = 
  case redeemer of
    BurnTreasuryCheckToken -> burnTokenCheck storeman ctx
    TreasuryCheckRedeemer treasuryRedeemer -> treasurySpendCheckA storeman treasuryRedeemer emptyByteString ctx
    TreasuryCheckRedeemer2 (TreasuryCheckProof2 treasuryRedeemer2 userData2) -> treasurySpendCheckA storeman treasuryRedeemer2 userData2 ctx


typedValidator :: TreasuryCheckParams -> PV2.TypedValidator TreasuryType
typedValidator = PV2.mkTypedValidatorParam @TreasuryType
    $$(PlutusTx.compile [|| mkValidator ||])
    $$(PlutusTx.compile [|| wrap ||])
    where
        wrap = PV2.mkUntypedValidator


validator :: TreasuryCheckParams -> Validator
validator = PV2.validatorScript . typedValidator

script :: TreasuryCheckParams -> Plutus.Script
script = unValidatorScript . validator

-- authorityCheckScriptShortBs :: TreasuryCheckParams -> SBS.ShortByteString
-- authorityCheckScriptShortBs = SBS.toShort . LBS.toStrict $ serialise . script

-- treasuryCheckScript :: CurrencySymbol -> PlutusScript PlutusScriptV2
-- treasuryCheckScript = PlutusScriptSerialised . authorityCheckScriptShortBs

treasuryCheckScript :: TreasuryCheckParams ->  PlutusScript PlutusScriptV2
treasuryCheckScript p = PlutusScriptSerialised
  . SBS.toShort
  . LBS.toStrict
  $ serialise 
  (script p)

treasuryCheckScriptHash :: TreasuryCheckParams -> Plutus.ValidatorHash
treasuryCheckScriptHash = PV2.validatorHash .typedValidator

-- authorityCheckScriptHashStr :: TreasuryCheckParams -> BuiltinByteString
-- authorityCheckScriptHashStr = case PlutusTx.fromBuiltinData $ PlutusTx.toBuiltinData . treasuryCheckScriptHash of 
--   Just s -> s
--   Nothing -> ""

treasuryCheckAddress ::TreasuryCheckParams -> Ledger.Address
treasuryCheckAddress = PV2.validatorAddress . typedValidator

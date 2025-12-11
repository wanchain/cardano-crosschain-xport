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
                  
module CrossChain.NFTTreasuryCheck
  ( nftTreasuryCheckScript
  -- , authorityCheckScriptShortBs
  ,nftTreasuryCheckScriptHash
  -- ,authorityCheckScriptHashStr
  ,nftTreasuryCheckAddress
  , NFTTreasuryCheckProof (..)
  , NFTTreasuryCheckProofData (..)
  , NFTTreasuryCheckRedeemer (..)
  ,NFTTreasuryCheckParams (..)
  ,NFTTreasuryCheckParams
  ) where

import Data.Aeson (FromJSON, ToJSON)
import GHC.Generics (Generic)
import Cardano.Api.Shelley (PlutusScript (..), PlutusScriptV2)
import Prelude hiding (($),(<>), (&&), (==),(||),(>=),(<=),(<),(-),(/=),not,length,filter,(>),(+),map,any,elem,fst,snd,mconcat,all)

import Codec.Serialise
import Data.ByteString.Lazy qualified as LBS
import Data.ByteString.Short qualified as SBS

-- import Plutus.Script.Utils.V2.Typed.Scripts.Validators as Scripts
import Plutus.Script.Utils.V2.Typed.Scripts qualified as PV2
import Plutus.Script.Utils.V2.Scripts as Scripts
import Plutus.V2.Ledger.Api qualified as Plutus
import Plutus.V2.Ledger.Contexts as V2
import PlutusTx qualified
import Plutus.V1.Ledger.Credential (Credential (..), StakingCredential (..))
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
import CrossChain.Types hiding (uniqueId)
-- ===================================================
-- import Plutus.V1.Ledger.Value
-- import Ledger.Address (PaymentPrivateKey (PaymentPrivateKey, unPaymentPrivateKey), PaymentPubKey (PaymentPubKey),PaymentPubKeyHash (..),unPaymentPubKeyHash,toPubKeyHash,toValidatorHash)

import Ledger hiding (validatorHash) --singleton


-- data UserData = 

data NFTTreasuryCheckProofData = NFTTreasuryCheckProofData
  {
    uniqueId :: BuiltinByteString
    , nonce :: TxOutRef
    , mode :: Integer
    , toAddr :: Address
    , policy :: BuiltinByteString
    , crossValue :: Value
    , userData :: OutputDatum
    , txType :: Integer
    , ttl :: Integer
    -- , signature :: BuiltinByteString
  }deriving (Prelude.Eq, Show)


PlutusTx.unstableMakeIsData ''NFTTreasuryCheckProofData
PlutusTx.makeLift ''NFTTreasuryCheckProofData


data NFTTreasuryCheckProof = NFTTreasuryCheckProof
  {
    proof :: NFTTreasuryCheckProofData
    , signature :: BuiltinByteString
  }deriving (Prelude.Eq, Show)


PlutusTx.unstableMakeIsData ''NFTTreasuryCheckProof
PlutusTx.makeLift ''NFTTreasuryCheckProof

data NFTTreasuryCheckRedeemer = BurnTreasuryCheckToken | NFTTreasuryCheckRedeemer NFTTreasuryCheckProof -- | NFTMerge BuiltinByteString
    deriving (Show, Prelude.Eq)
PlutusTx.unstableMakeIsData ''NFTTreasuryCheckRedeemer

data TreasuryType
instance Scripts.ValidatorTypes TreasuryType where
    type instance DatumType TreasuryType = ()
    type instance RedeemerType TreasuryType = NFTTreasuryCheckRedeemer

data NFTTreasuryCheckParams
  = NFTTreasuryCheckParams
      { tokenInfos :: GroupAdminNFTCheckTokenInfo
        , treasury :: ValidatorHash 
      } deriving (Generic, Prelude.Eq)
        -- deriving anyclass (ToJSON, FromJSON)

PlutusTx.unstableMakeIsData ''NFTTreasuryCheckParams
PlutusTx.makeLift ''NFTTreasuryCheckParams


{-# INLINABLE isValidValue #-}
isValidValue :: Value -> Bool -> CurrencySymbol -> Bool
isValidValue v bSingleSymbol targetSymbol 
  | bSingleSymbol == False = True
  | otherwise = all (\(cs',_,_) -> cs' == targetSymbol || cs' == Ada.adaSymbol) $ flattenValue v


{-# INLINABLE treasuryInputValue #-}
treasuryInputValue :: V2.TxInfo -> ValidatorHash -> Integer -> CurrencySymbol ->Value
treasuryInputValue info treasury txType symbol = go (Plutus.singleton Plutus.adaSymbol Plutus.adaToken 0) (V2.txInfoInputs info)
  where
    go v [] = v
    go v (V2.TxInInfo{V2.txInInfoResolved=V2.TxOut{V2.txOutValue,V2.txOutAddress= Address addressCredential _}} : rest) =
      case addressCredential of
        Plutus.ScriptCredential s -> 
          if s == treasury then 
            if isValidValue txOutValue (txType /= 2) symbol then go (v <> txOutValue) rest
            else traceError "d"
          else go v rest
        _ -> go v rest



{-# INLINABLE burnTokenCheck #-}
burnTokenCheck :: NFTTreasuryCheckParams -> V2.ScriptContext -> Bool
burnTokenCheck (NFTTreasuryCheckParams (GroupAdminNFTCheckTokenInfo _ (AdminNftTokenInfo adminNftSymbol adminNftName) (CheckTokenInfo checkTokenSymbol checkTokenName)) treasury) ctx = 
  traceIfFalse "a" ((( valueOf (V2.valueSpent info) adminNftSymbol adminNftName) == 1)
  && ((valueOf (V2.valueProduced info) checkTokenSymbol checkTokenName) == 0)
  && ((valueOf (treasuryInputValue info treasury 2 Ada.adaSymbol) Ada.adaSymbol Ada.adaToken) <= 0) )-- check tx exclude nfttreasury utxo in inputs
  where 
    info :: V2.TxInfo
    !info = V2.scriptContextTxInfo ctx

    -- groupInfo :: GroupInfoParams
    -- !groupInfo = getGroupInfo info groupInfoCurrency groupInfoTokenName

    hasAdminNftInInput :: Bool
    hasAdminNftInInput = 
      let !totalInputValue = V2.valueSpent info
          !amount = valueOf totalInputValue adminNftSymbol adminNftName
      in amount == 1

    -- treasuryCheckAddress :: Address
    -- treasuryCheckAddress = Address (Plutus.ScriptCredential (ValidatorHash (getGroupInfoParams groupInfo NFTTreasuryCheckVH))) (Just (Plutus.StakingHash (Plutus.ScriptCredential (ValidatorHash (getGroupInfoParams groupInfo StkVh)))))

    -- checkOutPut :: Bool
    -- checkOutPut = 
    --   let !outputValue = V2.valueProduced info
    --   in valueOf outputValue checkTokenSymbol checkTokenName == 0
 

{-# INLINABLE treasurySpendCheck #-}
treasurySpendCheck :: NFTTreasuryCheckParams -> NFTTreasuryCheckProof-> V2.ScriptContext -> Bool
treasurySpendCheck (NFTTreasuryCheckParams (GroupAdminNFTCheckTokenInfo (GroupNFTTokenInfo groupInfoCurrency groupInfoTokenName) (AdminNftTokenInfo adminNftSymbol adminNftName) (CheckTokenInfo checkTokenSymbol checkTokenName)) treasury) NFTTreasuryCheckProof{proof= p@NFTTreasuryCheckProofData{uniqueId, nonce, mode, toAddr, policy, crossValue, userData, txType, ttl}, signature} ctx = 
  traceIfFalse "1" (hasUTxO) && 
  traceIfFalse "2" (amountOfCheckTokeninOwnOutput == 1) && 
  traceIfFalse "3" checkSignature && 
  traceIfFalse "4" checkTx  &&
  traceIfFalse "5"  ((valueOf totalTreasuryInputValue Ada.adaSymbol Ada.adaToken) > 0) && -- hasTreasuryInput && -- check has treasury input 
  traceIfFalse "6" checkTtl
  where 
    info :: V2.TxInfo
    !info = V2.scriptContextTxInfo ctx

    hasUTxO :: Bool
    hasUTxO = 
      let V2.ScriptContext{V2.scriptContextPurpose=Spending txOutRef} = ctx in txOutRef == nonce

    hashRedeemer :: BuiltinByteString
    !hashRedeemer = sha3_256 (serialiseData $ PlutusTx.toBuiltinData p)
        -- let !tmp1 = serialiseData $ PlutusTx.toBuiltinData p --NFTTreasuryCheckProofData{uniqueId, nonce, mode, toAddr, policy, crossValue, userData, txType, ttl}
        -- in sha3_256 tmp1

    
    groupInfo :: GroupInfoParams
    !groupInfo = getGroupInfo info groupInfoCurrency groupInfoTokenName

    stkVh :: BuiltinByteString
    !stkVh = getGroupInfoParams groupInfo StkVh

    amountOfCheckTokeninOwnOutput :: Integer
    amountOfCheckTokeninOwnOutput = getAmountOfCheckTokeninOwnOutput ctx checkTokenSymbol checkTokenName stkVh


    gpk :: BuiltinByteString
    !gpk = getGroupInfoParams groupInfo GPK
    
    verify :: Bool
    !verify -- mode pk hash signature
      | mode == 0 = verifyEcdsaSecp256k1Signature gpk hashRedeemer signature
      | mode == 1 = verifySchnorrSecp256k1Signature gpk hashRedeemer signature
      | mode == 2 = verifyEd25519Signature gpk hashRedeemer signature
  -- | otherwise = traceError "m"

    checkSignature :: Bool
    checkSignature =
      if txType /=1 then  verify
      else 
        (V2.txSignedBy info  (PubKeyHash  (getGroupInfoParams groupInfo BalanceWorker)))

    targetSymbol :: CurrencySymbol 
    !targetSymbol = CurrencySymbol policy


    -- valuePaidToTarget :: Address -> Value
    -- valuePaidToTarget target = mconcat $ scriptOutputsAt2 target info userData
    -- valuePaidToTarget target@Address{addressCredential} =
    --   let values = scriptOutputsAt2 target info userData
    --       totalValue = 
    --         case addressCredential of
    --           Plutus.ScriptCredential _ ->
    --             case userData of
    --               NoOutputDatum -> Ada.lovelaceValueOf 0
    --               _ -> mconcat values
    --           _ -> mconcat values
    --   in  totalValue


    -- hasTreasuryInput :: Bool
    -- !hasTreasuryInput = ((valueOf totalTreasuryInputValue Ada.adaSymbol Ada.adaToken) > 0)
    
    changeValue :: Value
    !changeValue = mconcat (map snd $ scriptOutputsAt' treasury stkVh info True)
      -- let !vs = map snd $ scriptOutputsAt' treasury stkVh info True
      --     !retValue =  mconcat vs
      -- in retValue
        -- if (isValidValue retValue (txType /= 2) targetSymbol) then retValue
        -- else traceError "c"

    totalTreasuryInputValue :: Value
    !totalTreasuryInputValue = treasuryInputValue info treasury txType targetSymbol 

    checkTx :: Bool 
    checkTx =
      if txType /= 1 then 
        let !receivedValue = mconcat $ scriptOutputsAt2 toAddr info userData
            -- !inputValue = treasuryInputValue info treasury txType targetSymbol 
            !valueSum = crossValue <> changeValue  -- <> (Ada.lovelaceValueOf (valueOf totalTreasuryInputValue Ada.adaSymbol Ada.adaToken))
        in 
          (isValidValue (valueSum <> receivedValue) (txType /= 2) targetSymbol) -- only cross one kind token(the policies of all assets is the same one)
          && (receivedValue `geq` crossValue) 
          && (valueSum `geq` totalTreasuryInputValue) 
          -- && (isValidValue receivedValue (txType /= 2) targetSymbol)
      else 
        changeValue `geq` totalTreasuryInputValue
        && (isValidValue changeValue (txType /=2) targetSymbol)

    checkTtl :: Bool
    checkTtl = 
      let !range = V2.txInfoValidRange info
      in  (Plutus.POSIXTime (ttl + 1)) `after` range


{-# INLINABLE mkValidator #-}
mkValidator :: NFTTreasuryCheckParams ->() -> NFTTreasuryCheckRedeemer -> V2.ScriptContext -> Bool
mkValidator storeman _ redeemer ctx = 
  case redeemer of
    BurnTreasuryCheckToken -> burnTokenCheck storeman ctx
    NFTTreasuryCheckRedeemer treasuryRedeemer -> treasurySpendCheck storeman treasuryRedeemer ctx
    -- NFTMerge policy -> nftMerge storeman ctx policy-- TBD


typedValidator :: NFTTreasuryCheckParams -> PV2.TypedValidator TreasuryType
typedValidator = PV2.mkTypedValidatorParam @TreasuryType
    $$(PlutusTx.compile [|| mkValidator ||])
    $$(PlutusTx.compile [|| wrap ||])
    where
        wrap = PV2.mkUntypedValidator


validator :: NFTTreasuryCheckParams -> Validator
validator = PV2.validatorScript . typedValidator

script :: NFTTreasuryCheckParams -> Plutus.Script
script = unValidatorScript . validator

-- authorityCheckScriptShortBs :: NFTTreasuryCheckParams -> SBS.ShortByteString
-- authorityCheckScriptShortBs = SBS.toShort . LBS.toStrict $ serialise . script

-- nftTreasuryCheckScript :: CurrencySymbol -> PlutusScript PlutusScriptV2
-- nftTreasuryCheckScript = PlutusScriptSerialised . authorityCheckScriptShortBs

nftTreasuryCheckScript :: NFTTreasuryCheckParams ->  PlutusScript PlutusScriptV2
nftTreasuryCheckScript p = PlutusScriptSerialised
  . SBS.toShort
  . LBS.toStrict
  $ serialise 
  (script p)

nftTreasuryCheckScriptHash :: NFTTreasuryCheckParams -> Plutus.ValidatorHash
nftTreasuryCheckScriptHash = PV2.validatorHash .typedValidator

-- authorityCheckScriptHashStr :: NFTTreasuryCheckParams -> BuiltinByteString
-- authorityCheckScriptHashStr = case PlutusTx.fromBuiltinData $ PlutusTx.toBuiltinData . nftTreasuryCheckScriptHash of 
--   Just s -> s
--   Nothing -> ""

nftTreasuryCheckAddress ::NFTTreasuryCheckParams -> Ledger.Address
nftTreasuryCheckAddress = PV2.validatorAddress . typedValidator

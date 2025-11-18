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

module CrossChain.InboundMintCheck
  ( inboundMintCheckScript
  -- , authorityCheckScriptShortBs
  ,inboundMintCheckScriptHash
  -- ,authorityCheckScriptHashStr
  ,inboundMintCheckAddress
  , InboundProof (..)
  , InboundCheckRedeemer (..)
  -- , InboundMintCheckInfo (..)
  -- , InboundMintCheckInfo
  ) where

import Data.Aeson (FromJSON, ToJSON)
import GHC.Generics (Generic)
import Cardano.Api.Shelley (PlutusScript (..), PlutusScriptV2)
import Prelude hiding (($),(<>), (&&), (&&), (==),(||),(>=),(<=),(+),(<),(-),not,length,filter,(>),(!!),map,head,reverse,any,elem,snd,mconcat,negate,all,fst)

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
import PlutusTx.Prelude  hiding (SemigroupInfo (..), unless, (.))
-- import PlutusTx.Prelude qualified as PlutusPrelude
import           Ledger               hiding (validatorHash,validatorHash)
import Plutus.V2.Ledger.Tx (isPayToScriptOut,OutputDatum (..))
import Ledger.Typed.Scripts (ValidatorTypes (..), TypedValidator (..),mkTypedValidator,mkTypedValidatorParam) --,mkUntypedValidator )
-- import Plutus.Script.Utils.Typed (validatorScript,validatorAddress,validatorHash)

import Data.ByteString qualified as ByteString
import Ledger.Crypto (PubKey (..), PubKeyHash, pubKeyHash)
import Plutus.V1.Ledger.Bytes (LedgerBytes (LedgerBytes),fromBytes,getLedgerBytes)
import Ledger.Ada  as Ada
import Plutus.V1.Ledger.Value (valueOf,currencySymbol,tokenName,symbols,flattenValue,assetClass)
-- import Plutus.V1.Ledger.Interval (Extended (..))
import PlutusTx.Builtins --(decodeUtf8,sha3_256,appendByteString)
import Ledger.Address 
import Ledger.Value
import Plutus.V2.Ledger.Contexts as V2
import Ledger.Typed.Scripts qualified as Scripts hiding (validatorHash)
import Plutus.V1.Ledger.Tx
-- import CrossChain.Types2 
import CrossChain.Types -- (GroupNFTTokenInfo (..), InboundMintCheckInfo (..), GroupAdminNFTCheckTokenInfo (..),CrossMsgData (..), ParamType (..),GroupInfoParams (..),NonsenseDatum (..), AdminNftTokenInfo (..), CheckTokenInfo (..), scriptOutputsAt2, MsgAddress (..), getGroupInfo, getGroupInfoParams)
import Plutus.Script.Utils.V2.Address (mkValidatorAddress)
-- ===================================================
-- import Plutus.V1.Ledger.Value
-- import Ledger.Address (PaymentPrivateKey (PaymentPrivateKey, unPaymentPrivateKey), PaymentPubKey (PaymentPubKey),PaymentPubKeyHash (..),unPaymentPubKeyHash,toPubKeyHash,toValidatorHash)

import Ledger hiding (validatorHash) --singleton





data InboundProofData = InboundProofData
  {
    crossMsgData :: CrossMsgData
    , ttl :: Integer
    , mode :: Integer
    , nonce :: TxOutRef
  }deriving (Show, Prelude.Eq)

PlutusTx.unstableMakeIsData ''InboundProofData
PlutusTx.makeLift ''InboundProofData


data InboundProof = InboundProof
  {
    proofData :: InboundProofData
    , signature :: BuiltinByteString
  }deriving ( Show, Prelude.Eq)


PlutusTx.unstableMakeIsData ''InboundProof
PlutusTx.makeLift ''InboundProof


data InboundCheckRedeemer = BurnInboundCheckToken | InboundCheckRedeemer InboundProof
    deriving (Show, Prelude.Eq)
PlutusTx.unstableMakeIsData ''InboundCheckRedeemer


data InboundCheckType
instance Scripts.ValidatorTypes InboundCheckType where
    type instance DatumType InboundCheckType = ()
    type instance RedeemerType InboundCheckType = InboundCheckRedeemer


{-# INLINABLE burnTokenCheck #-}
burnTokenCheck :: InboundMintCheckInfo -> V2.ScriptContext -> Bool
burnTokenCheck (InboundMintCheckInfo (GroupAdminNFTCheckTokenInfo _ (AdminNftTokenInfo adminNftSymbol adminNftName) (CheckTokenInfo checkTokenSymbol checkTokenName)) _ _) ctx = 
  traceIfFalse "a"  hasAdminNftInInput
  && traceIfFalse "b" checkOutput
  where 
    info :: V2.TxInfo
    !info = V2.scriptContextTxInfo ctx

  
    hasAdminNftInInput :: Bool
    hasAdminNftInInput = 
      let !totalInputValue = V2.valueSpent info
          !amount = valueOf totalInputValue adminNftSymbol adminNftName
      in amount == 1

    checkOutput :: Bool
    checkOutput = 
      let !outputValue = V2.valueProduced info
      in valueOf outputValue checkTokenSymbol checkTokenName == 0




{-# INLINABLE mintSpendCheck #-}
mintSpendCheck :: InboundMintCheckInfo -> InboundProof -> V2.ScriptContext -> Bool
mintSpendCheck (InboundMintCheckInfo (GroupAdminNFTCheckTokenInfo (GroupNFTTokenInfo groupInfoCurrency groupInfoTokenName) _ (CheckTokenInfo checkTokenSymbol checkTokenName)) mintPolicy mintTokenName) (InboundProof proofData signature) ctx = -- True
  traceIfFalse "1" hasUTxO 
  && traceIfFalse "2" (amountOfCheckTokeninOwnOutput == 1) 
  && traceIfFalse "3" checkSignature
  && traceIfFalse "4" checkOutput 
  && traceIfFalse "5" checkTtl
  where
    
    info :: V2.TxInfo
    !info = V2.scriptContextTxInfo ctx

    hasUTxO :: Bool
    hasUTxO = 
      let V2.ScriptContext{V2.scriptContextPurpose=Spending txOutRef} = ctx in txOutRef == (nonce proofData)

    groupInfo :: GroupInfoParams
    !groupInfo = getGroupInfo info groupInfoCurrency groupInfoTokenName

    stkVh :: BuiltinByteString
    !stkVh = getGroupInfoParams groupInfo StkVh

    amountOfCheckTokeninOwnOutput :: Integer
    amountOfCheckTokeninOwnOutput = getAmountOfCheckTokeninOwnOutput ctx checkTokenSymbol checkTokenName stkVh

    hashRedeemer :: BuiltinByteString
    !hashRedeemer = sha3_256 (serialiseData $ PlutusTx.toBuiltinData proofData)

    gpk :: BuiltinByteString
    !gpk = getGroupInfoParams groupInfo GPK

    checkSignature :: Bool
    checkSignature -- mode pk hash signature
      | modeT == 0 = verifyEcdsaSecp256k1Signature gpk hashRedeemer signature
      | modeT == 1 = verifySchnorrSecp256k1Signature gpk hashRedeemer signature
      | modeT == 2 = verifyEd25519Signature gpk hashRedeemer signature

    crossMsgD :: CrossMsgData
    crossMsgD = crossMsgData proofData

    modeT :: Integer
    !modeT = mode proofData

    msgConsumer :: Address
    !msgConsumer = 
      case targetContract crossMsgD of
        LocalAddress a -> a

    expectedDatum :: OutputDatum
    !expectedDatum =  OutputDatum (Datum (PlutusTx.toBuiltinData crossMsgD))

    checkOutput :: Bool
    !checkOutput = 
      case scriptOutputsAt2 msgConsumer info expectedDatum of
        [v] -> (isSingleAsset v mintPolicy mintTokenName)
  --         -- case Plutus.getDatum d of 
  --         -- case Plutus.fromBuiltinData @CrossMsgData $ Plutus.getDatum d of 
  --         --   Just ibd' -> True -- (crossMsgData == ibd') && (isSingleAsset v mintPolicy mintTokenName)

    
    checkTtl :: Bool
    checkTtl = (Plutus.POSIXTime ((ttl proofData) + 1)) `after` (V2.txInfoValidRange info)


{-# INLINABLE mkValidator #-}
mkValidator :: InboundMintCheckInfo ->() -> InboundCheckRedeemer  -> V2.ScriptContext -> Bool
mkValidator storeman _ redeemer ctx = 
  case redeemer of
    BurnInboundCheckToken -> burnTokenCheck storeman ctx
    InboundCheckRedeemer mintCheckProof -> mintSpendCheck storeman mintCheckProof ctx
  -- where
  --   ctx = PlutusTx.unsafeFromBuiltinData @V2.ScriptContext rawContext


validator :: InboundMintCheckInfo -> Scripts.Validator
validator p = Plutus.mkValidatorScript $
    $$(PlutusTx.compile [|| validatorParam ||])
        `PlutusTx.applyCode`
            PlutusTx.liftCode p
    where validatorParam s = PV2.mkUntypedValidator (mkValidator s)

script :: InboundMintCheckInfo -> Plutus.Script
script = unValidatorScript . validator

inboundMintCheckScript :: InboundMintCheckInfo ->  PlutusScript PlutusScriptV2
inboundMintCheckScript p = PlutusScriptSerialised
  . SBS.toShort
  . LBS.toStrict
  $ serialise 
  (script p)

inboundMintCheckScriptHash :: InboundMintCheckInfo -> Plutus.ValidatorHash
inboundMintCheckScriptHash = Scripts.validatorHash . validator

inboundMintCheckAddress ::InboundMintCheckInfo -> Ledger.Address
inboundMintCheckAddress = mkValidatorAddress . validator

{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE NoImplicitPrelude #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeApplications  #-}
{-# LANGUAGE TypeFamilies      #-}
{-# LANGUAGE DeriveAnyClass     #-}
{-# LANGUAGE DeriveGeneric      #-}
{-# LANGUAGE DerivingStrategies #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE NamedFieldPuns       #-}

module CrossChain.OutboundToken
  ( outboundTokenScript
  , outboundTokenScriptShortBs
  , outboundTokenCurSymbol
  , OutboundTokenParams (..)
  ) where


import Cardano.Api.Shelley (PlutusScript (..), PlutusScriptV2)
import Prelude hiding (($), (&&), (&&), (==),(-),(!!),(||),(<),not,length,filter,(>),map,head,any)

import Codec.Serialise
import Data.ByteString.Lazy qualified as LBS
import Data.ByteString.Short qualified as SBS

import Plutus.Script.Utils.V2.Typed.Scripts.MonetaryPolicies as V2
import Plutus.Script.Utils.V2.Scripts (scriptCurrencySymbol)
import Plutus.V2.Ledger.Api qualified as V2
import Plutus.V2.Ledger.Contexts as V2
import PlutusTx qualified
import PlutusTx.Builtins
import PlutusTx.Prelude hiding (SemigroupInfo (..), unless, (.))

import Ledger.Address (PaymentPrivateKey (PaymentPrivateKey, unPaymentPrivateKey), PaymentPubKey (PaymentPubKey),PaymentPubKeyHash (..),unPaymentPubKeyHash,toPubKeyHash,toValidatorHash)
import Plutus.V1.Ledger.Value
import Plutus.V1.Ledger.Bytes (LedgerBytes (LedgerBytes))
import Ledger.Crypto (PubKey (..), PubKeyHash)
import Data.Aeson (FromJSON, ToJSON)
import PlutusTx (BuiltinData, CompiledCode, Lift, applyCode, liftCode, fromData)
import GHC.Generics (Generic)
import Plutus.Script.Utils.Typed (validatorScript,validatorAddress,validatorHash)
import Ledger.Typed.Scripts qualified as Scripts hiding (validatorHash)
import CrossChain.Types(CrossMsgData (..), GroupNFTTokenInfo (..), ParamType (..), GroupInfoParams (..), OutboundTokenParams (..),isSingleAsset, getGroupInfo, getGroupInfoParams, MsgAddress (..))


{-# INLINABLE groupInfoFromUtxo #-}
groupInfoFromUtxo :: V2.TxOut -> GroupInfoParams
groupInfoFromUtxo V2.TxOut{V2.txOutDatum=V2.OutputDatum datum} = case (V2.fromBuiltinData $ V2.getDatum datum) of
  Just groupInfo -> groupInfo

{-# INLINABLE mkPolicy #-}
mkPolicy :: OutboundTokenParams -> () -> V2.ScriptContext -> Bool
mkPolicy  (OutboundTokenParams (GroupNFTTokenInfo groupNftSymbol groupNftName) tokenName) _ ctx =
  if mintValue < 0
    then True 
  else 
    traceIfFalse "hmm" (checkInputAndOutput && (mintValue == 1))
  where
    info :: V2.TxInfo
    info = V2.scriptContextTxInfo ctx

    groupInfo :: GroupInfoParams
    !groupInfo = getGroupInfo info groupNftSymbol groupNftName

    outboundTokenHolder :: BuiltinByteString
    !outboundTokenHolder = getGroupInfoParams groupInfo OutboundHolderVH

    checkInputAndOutput :: Bool
    checkInputAndOutput = 
      case V2.scriptOutputsAt (V2.ValidatorHash outboundTokenHolder) info of
        [((V2.OutputDatum d),v)] ->
          case V2.fromBuiltinData @CrossMsgData $ V2.getDatum d of
            Just CrossMsgData{sourceContract=LocalAddress s} -> (isSingleAsset v (ownCurrencySymbol ctx) tokenName)  && (checkInput s)

    checkInput :: V2.Address -> Bool
    checkInput s = 
      let sourceInputs = filter (\V2.TxInInfo{V2.txInInfoResolved= V2.TxOut{V2.txOutAddress=d}} -> d == s) (V2.txInfoInputs info)
      in
        (length sourceInputs) > 0

    mintValue :: Integer
    mintValue = valueOf (V2.txInfoMint info) (ownCurrencySymbol ctx) tokenName

policy :: OutboundTokenParams -> V2.MintingPolicy
policy oref = V2.mkMintingPolicyScript $ $$(PlutusTx.compile [|| \c -> V2.mkUntypedMintingPolicy (mkPolicy c)  ||]) 
    `PlutusTx.applyCode` PlutusTx.liftCode oref


outboundTokenCurSymbol :: OutboundTokenParams -> CurrencySymbol
outboundTokenCurSymbol = scriptCurrencySymbol . policy

plutusScript :: OutboundTokenParams -> V2.Script
plutusScript = V2.unMintingPolicyScript . policy

validator :: OutboundTokenParams -> V2.Validator
validator = V2.Validator . plutusScript

scriptAsCbor :: OutboundTokenParams -> LBS.ByteString
scriptAsCbor = serialise . validator

outboundTokenScript :: OutboundTokenParams -> PlutusScript PlutusScriptV2
outboundTokenScript mgrData = PlutusScriptSerialised . SBS.toShort $ LBS.toStrict (scriptAsCbor mgrData)

outboundTokenScriptShortBs :: OutboundTokenParams -> SBS.ShortByteString
outboundTokenScriptShortBs mgrData = SBS.toShort . LBS.toStrict $ (scriptAsCbor mgrData)

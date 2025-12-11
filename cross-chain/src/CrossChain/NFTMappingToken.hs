
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

module CrossChain.NFTMappingToken
  ( nftMappingTokenScript
  , nftMappingTokenScriptShortBs
  , nftMappingTokenCurSymbol
  , NFTMappingParams (..)
  ) where


import Cardano.Api.Shelley (PlutusScript (..), PlutusScriptV2)
import Prelude hiding (($), (&&), (&&), (==),(-),(!!),(||),(<),not,length,filter,(>),map,head,any,all)

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
-- import Plutus.V1.Ledger.Scripts (unValidatorScript)
import Ledger.Typed.Scripts qualified as Scripts hiding (validatorHash)
import CrossChain.Types 



{-# INLINABLE groupInfoFromUtxo #-}
groupInfoFromUtxo :: V2.TxOut -> GroupInfoParams
groupInfoFromUtxo V2.TxOut{V2.txOutDatum=V2.OutputDatum datum} = case (V2.fromBuiltinData $ V2.getDatum datum) of
  Just groupInfo -> groupInfo


data NFTMappingParams
  = NFTMappingParams
      { checkToken :: CheckTokenInfo
        , unique :: BuiltinByteString 
      } deriving (Generic, Prelude.Eq)
        -- deriving anyclass (ToJSON, FromJSON)

PlutusTx.unstableMakeIsData ''NFTMappingParams
PlutusTx.makeLift ''NFTMappingParams

-- How to deal with nftref utxo burnning

{-# INLINABLE mkPolicy #-}
mkPolicy :: NFTMappingParams -> () -> ScriptContext -> Bool
mkPolicy  (NFTMappingParams (CheckTokenInfo checkTokenSymbol checkTokenName) _) _ ctx =
  if isBurn 
    then True 
  else 
    traceIfFalse "hmm3" hasCheckTokenInput
  where
    info :: V2.TxInfo
    info = V2.scriptContextTxInfo ctx

    hasCheckTokenInput :: Bool
    !hasCheckTokenInput = 
      let !totalInputValue = V2.valueSpent info
          !amount = valueOf totalInputValue checkTokenSymbol checkTokenName
      in amount == 1

    isBurn :: Bool
    isBurn = all (\(symbol,_,a) -> (symbol == ownCurrencySymbol ctx) && (a < 0)) (flattenValue $ V2.txInfoMint info)
        -- [(symbol,_,a)] -> (symbol == ownCurrencySymbol ctx) && (a < 0)

policy :: NFTMappingParams -> V2.MintingPolicy
policy oref = V2.mkMintingPolicyScript $ $$(PlutusTx.compile [|| \c -> V2.mkUntypedMintingPolicy (mkPolicy c)  ||]) 
    `PlutusTx.applyCode` PlutusTx.liftCode oref


nftMappingTokenCurSymbol :: NFTMappingParams -> CurrencySymbol
nftMappingTokenCurSymbol = scriptCurrencySymbol . policy

plutusScript :: NFTMappingParams -> V2.Script
plutusScript = V2.unMintingPolicyScript . policy

validator :: NFTMappingParams -> V2.Validator
validator = V2.Validator . plutusScript

scriptAsCbor :: NFTMappingParams -> LBS.ByteString
scriptAsCbor = serialise . validator

nftMappingTokenScript :: NFTMappingParams -> PlutusScript PlutusScriptV2
nftMappingTokenScript mgrData = PlutusScriptSerialised . SBS.toShort $ LBS.toStrict (scriptAsCbor mgrData)

nftMappingTokenScriptShortBs :: NFTMappingParams -> SBS.ShortByteString
nftMappingTokenScriptShortBs mgrData = SBS.toShort . LBS.toStrict $ (scriptAsCbor mgrData)
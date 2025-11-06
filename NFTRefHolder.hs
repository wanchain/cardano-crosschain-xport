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
-- {-# OPTIONS_GHC -fplugin-opt PlutusTx.Plugin:profile-all #-}
-- {-# OPTIONS_GHC -fplugin-opt PlutusTx.Plugin:dump-uplc #-}

module CrossChain.NFTRefHolder
  ( nftRefHolderScript
  -- , nftRefHolderScriptShortBs
  ,nftRefHolderScriptHash
  -- ,nftRefHolderScriptHashStr
  ,nftRefHolderAddress
  ) where

import Data.Aeson (FromJSON, ToJSON)
import GHC.Generics (Generic)
import Cardano.Api.Shelley (PlutusScript (..), PlutusScriptV2)
import Prelude hiding (($),(<>), (&&), (||),(>=),(<),(==),(-),not,length,filter,foldMap,(>),(!!),map,head,reverse,any,elem,snd,mconcat,negate,divide)

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
import PlutusTx.Prelude hiding (SemigroupInfo (..), unless, (.))
-- import PlutusTx.Prelude (Eq)
-- import PlutusTx.Prelude qualified as PlutusPrelude
import           Ledger               hiding (validatorHash,validatorHash)
import Plutus.V2.Ledger.Tx (isPayToScriptOut,OutputDatum (..))
import Ledger.Typed.Scripts (ValidatorTypes (..), TypedValidator (..),mkTypedValidator,mkTypedValidatorParam) --,mkUntypedValidator )
-- import Plutus.Script.Utils.Typed (validatorScript,validatorAddress,validatorHash)

import Data.ByteString qualified as ByteString
import Ledger.Crypto (PubKey (..), PubKeyHash, pubKeyHash)
import Plutus.V1.Ledger.Bytes (LedgerBytes (LedgerBytes),fromBytes,getLedgerBytes)
import Ledger.Ada  as Ada
import Plutus.V1.Ledger.Value (valueOf,currencySymbol,tokenName,symbols,flattenValue)
import PlutusTx.Builtins --(decodeUtf8,sha3_256,appendByteString)
import Ledger.Address 
import Ledger.Value
import Plutus.V2.Ledger.Contexts as V2
import Ledger.Typed.Scripts qualified as Scripts hiding (validatorHash)
import Plutus.V1.Ledger.Tx
import Plutus.Script.Utils.V2.Address (mkValidatorAddress)
-- ===================================================
-- import Plutus.V1.Ledger.Value
-- import Ledger.Address (PaymentPrivateKey (PaymentPrivateKey, unPaymentPrivateKey), PaymentPubKey (PaymentPubKey),PaymentPubKeyHash (..),unPaymentPubKeyHash,toPubKeyHash,toValidatorHash)

import Ledger hiding (validatorHash) --singleton
-- import Plutus.V1.Ledger.Scripts (getDatum)
import CrossChain.Types 



{-# INLINABLE mkValidator #-} -- V2.ScriptContext
mkValidator :: PubKeyHash -> () -> () -> V2.ScriptContext -> Bool
mkValidator pkh _ _ ctx = -- True
  traceIfFalse "f" (V2.txSignedBy (V2.scriptContextTxInfo ctx)  pkh)
--   where
--     info :: V2.TxInfo
--     !info = V2.scriptContextTxInfo ctx
    
--     txInputs :: [TxInInfo']
--     !txInputs = txInfoInputs' info

--     totalValue :: Value
--     !totalValue = go (Plutus.singleton Plutus.adaSymbol Plutus.adaToken 0) txInputs
--       where
--         go v [] = v
--         -- go v (TxInInfo'{txInInfoResolved'=TxOut'{txOutValue'}} : rest) = go (v <>txOutValue') rest
--         go v (inInfo : rest) = go (v <> (txOutValue' $ txInInfoResolved' inInfo)) rest

--     hasTreasuryTokenInput :: Bool
--     !hasTreasuryTokenInput = 
--       let !totalInputValue = totalValue -- foldMap (txOutValue' . txInInfoResolved') txInputs
--           !amount = valueOf totalInputValue checkTokenSymbol checkTokenName
--       in amount == 1



-- typedValidator :: PubKeyHash -> PV2.TypedValidator TreasuryType
-- typedValidator = PV2.mkTypedValidatorParam @TreasuryType
--     $$(PlutusTx.compile [|| mkValidator ||])
--     $$(PlutusTx.compile [|| wrap ||])
--     where
--         wrap = PV2.mkUntypedValidator

validator :: PubKeyHash -> Scripts.Validator
validator p = Plutus.mkValidatorScript $
    $$(PlutusTx.compile [|| validatorParam ||])
        `PlutusTx.applyCode`
            PlutusTx.liftCode p
    where validatorParam s = PV2.mkUntypedValidator (mkValidator s)


-- validator :: PubKeyHash -> Validator
-- validator = PV2.validatorScript . typedValidator

script :: PubKeyHash -> Plutus.Script
script = Plutus.unValidatorScript . validator

-- nftRefHolderScriptShortBs :: PubKeyHash -> SBS.ShortByteString
-- nftRefHolderScriptShortBs = SBS.toShort . LBS.toStrict $ serialise . script

-- nftRefHolderScript :: PubKeyHash -> PlutusScript PlutusScriptV2
-- nftRefHolderScript = PlutusScriptSerialised . nftRefHolderScriptShortBs

nftRefHolderScript :: PubKeyHash ->  PlutusScript PlutusScriptV2
nftRefHolderScript p = PlutusScriptSerialised
  . SBS.toShort
  . LBS.toStrict
  $ serialise 
  (script p)

nftRefHolderScriptHash :: PubKeyHash -> Plutus.ValidatorHash
nftRefHolderScriptHash = Scripts.validatorHash . validator

-- nftRefHolderScriptHashStr :: PubKeyHash -> BuiltinByteString
-- nftRefHolderScriptHashStr = case PlutusTx.fromBuiltinData $ PlutusTx.toBuiltinData . nftRefHolderScriptHash of 
--   Just s -> s
--   Nothing -> ""

nftRefHolderAddress ::PubKeyHash -> Ledger.Address
nftRefHolderAddress = mkValidatorAddress . validator

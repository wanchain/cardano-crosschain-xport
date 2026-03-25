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

module CrossChain.XPort
  ( xPortScript
  ,xPortScriptHash
  ,xPortAddress
  ,KeyParam (..)
  ) where

import Data.Aeson (FromJSON, ToJSON)
import GHC.Generics (Generic)
import Cardano.Api.Shelley (PlutusScript (..), PlutusScriptV2)
import Prelude hiding (($),(<>), (&&), (||),(>=),(<),(==),(-),not,length,filter,foldMap,(>),(!!),map,head,reverse,any,elem,snd,mconcat,negate,divide)

import Codec.Serialise
import Data.ByteString.Lazy qualified as LBS
import Data.ByteString.Short qualified as SBS

import Plutus.Script.Utils.V2.Typed.Scripts qualified as PV2
import Plutus.Script.Utils.V2.Scripts as Scripts
import Plutus.V2.Ledger.Api qualified as Plutus
import Plutus.V2.Ledger.Contexts as V2
import PlutusTx qualified
import PlutusTx.Builtins
import PlutusTx.Prelude hiding (SemigroupInfo (..), unless, (.))
import           Ledger               hiding (validatorHash,validatorHash)
import Plutus.V2.Ledger.Tx (isPayToScriptOut,OutputDatum (..))
import Ledger.Typed.Scripts (ValidatorTypes (..), TypedValidator (..),mkTypedValidator,mkTypedValidatorParam)

import Data.ByteString qualified as ByteString
import Ledger.Crypto (PubKey (..), PubKeyHash, pubKeyHash)
import Plutus.V1.Ledger.Bytes (LedgerBytes (LedgerBytes),fromBytes,getLedgerBytes)
import Ledger.Ada  as Ada
import Plutus.V1.Ledger.Value (valueOf,currencySymbol,tokenName,symbols,flattenValue)
import PlutusTx.Builtins
import Ledger.Address 
import Ledger.Value
import Plutus.V2.Ledger.Contexts as V2
import Ledger.Typed.Scripts qualified as Scripts hiding (validatorHash)
import Plutus.V1.Ledger.Tx
import Plutus.Script.Utils.V2.Address (mkValidatorAddress)

import Ledger hiding (validatorHash)
import CrossChain.Types 


data KeyParam
  = KeyParam
      { groupNft :: PubKeyHash
        , nonce :: Integer
      } deriving stock (Generic)

PlutusTx.unstableMakeIsData ''KeyParam
PlutusTx.makeLift ''KeyParam


{-# INLINABLE mkValidator #-}
mkValidator :: KeyParam -> () -> () -> V2.ScriptContext -> Bool
mkValidator (KeyParam pkh _) _ _ ctx = 
  traceIfFalse "f" (V2.txSignedBy (V2.scriptContextTxInfo ctx)  pkh)

validator :: KeyParam -> Scripts.Validator
validator p = Plutus.mkValidatorScript $
    $$(PlutusTx.compile [|| validatorParam ||])
        `PlutusTx.applyCode`
            PlutusTx.liftCode p
    where validatorParam s = PV2.mkUntypedValidator (mkValidator s)

script :: KeyParam -> Plutus.Script
script = Plutus.unValidatorScript . validator

xPortScript :: KeyParam ->  PlutusScript PlutusScriptV2
xPortScript p = PlutusScriptSerialised
  . SBS.toShort
  . LBS.toStrict
  $ serialise 
  (script p)

xPortScriptHash :: KeyParam -> Plutus.ValidatorHash
xPortScriptHash = Scripts.validatorHash . validator

xPortAddress ::KeyParam -> Ledger.Address
xPortAddress = mkValidatorAddress . validator

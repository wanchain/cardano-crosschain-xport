{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DerivingStrategies #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE NamedFieldPuns #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE NoImplicitPrelude #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# OPTIONS_GHC -Wno-redundant-constraints #-}
{-# OPTIONS_GHC -fno-ignore-interface-pragmas #-}
{-# OPTIONS_GHC -fno-omit-interface-pragmas #-}
{-# OPTIONS_GHC -fno-specialise #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# OPTIONS_GHC -fobject-code #-}
{-# LANGUAGE ViewPatterns         #-}

module CrossChain.Types2 where

import Prelude hiding((&&),(==),($),(!!),(<),(>),(/=),(.),(||),negate,length,filter,map,fst,snd,mconcat,all,not,foldMap)
import GHC.Generics (Generic)
-- import Builtins qualified as Builtins
import Data.ByteString qualified as ByteString
import Plutus.V1.Ledger.Bytes (LedgerBytes (LedgerBytes),fromBytes,getLedgerBytes)
-- import Plutus.V1.Ledger.Value (TokenName (..), CurrencySymbol)
import Plutus.V2.Ledger.Api (TokenName (..), CurrencySymbol,TxOutRef, Value, DatumHash, TxId (..)
    , TxOut(..)
    , TxInfo (..)
    , ScriptPurpose (..)
    , TxInInfo (..)
    , TxOutRef(..)
    , OutputDatum (..),Datum (..),Address(..),ScriptHash (..)
    ,fromBuiltinData,getDatum,ValidatorHash (..),Credential (..)
    , StakingCredential (..), PubKeyHash (..), POSIXTimeRange (..)
    )
-- import Plutus.V2.Ledger.Tx as V2
import PlutusTx --(CompiledCode, Lift, UnsafeFromData (unsafeFromBuiltinData), applyCode, liftCode,BuiltinData,makeLift,makeIsDataIndexed)
import PlutusTx.Prelude 
-- import Prelude (check)
import Plutus.Script.Utils.Typed (UntypedValidator)
import Plutus.V2.Ledger.Contexts as V2
import Plutus.V1.Ledger.Value (valueOf,flattenValue,assetClass,assetClassValueOf) -- ,currencySymbol,tokenName,symbols
import Ledger.Ada  as Ada
import PlutusTx.Builtins
import CrossChain.Types (GroupAdminNFTCheckTokenInfo (..), ParamType (..),GroupInfoParams (..),NonsenseDatum (..))
-- {-# INLINABLE groupInfoNFTCurrency #-}
-- groupInfoNFTCurrency :: CurrencySymbol
-- groupInfoNFTCurrency = groupNFTSymbol nftNonce

-- {-# INLINABLE groupInfoNFTName #-}
-- groupInfoNFTName :: TokenName
-- groupInfoNFTName = TokenName (encodeUtf8 "GroupInfoTokenCoin")




{-# INLINABLE mkUntypedValidator' #-}
mkUntypedValidator'
    :: forall d r
    . (UnsafeFromData d, UnsafeFromData r)
    => (d -> r -> BuiltinData -> Bool)
    -> UntypedValidator
-- We can use unsafeFromBuiltinData here as we would fail immediately anyway if parsing failed
mkUntypedValidator' f d r p =
    check $ f (unsafeFromBuiltinData d) (unsafeFromBuiltinData r) (unsafeFromBuiltinData p)



-- | A pending transaction. This is the view as seen by validator scripts, so some details are stripped out.
data TxOut' = TxOut' {
    txOutAddress'         :: Address,
    txOutValue'           :: Value,
    txOutDatum'           :: OutputDatum,
    txOutReferenceScript' :: BuiltinData
    }
    deriving stock (Generic, Prelude.Eq)

data TxInInfo' = TxInInfo'
    { txInInfoOutRef'   :: TxOutRef
    , txInInfoResolved' :: TxOut'
    } deriving (Generic, Prelude.Eq)


data TxInfo' = TxInfo'
  { txInfoInputs'          :: [TxInInfo'] -- ^ Transaction inputs
    , txInfoReferenceInputs' :: [TxInInfo'] -- ^ Transaction reference inputs
    , txInfoOutputs'        :: [TxOut'] -- ^ Transaction outputs
    , txInfoFee'            :: BuiltinData -- ^ The fee paid by this transaction.
    , txInfoMint'           :: Value -- ^ The 'Value' minted by this transaction.
    , txInfoDCert'          :: BuiltinData -- ^ Digests of certificates included in this transaction
    , txInfoWdrl'           :: BuiltinData -- ^ Withdrawals
    , txInfoValidRange'     :: POSIXTimeRange -- ^ The valid range for the transaction.
    , txInfoSignatories'    :: BuiltinData -- ^ Signatures provided with the transaction, attested that they all signed the tx
    , txInfoRedeemers'      :: BuiltinData
    , txInfoData'           :: BuiltinData
    , txInfoId'             :: BuiltinData
    -- ^ Hash of the pending transaction (excluding witnesses)
    } deriving (Generic, Prelude.Eq)

data StoremanScriptContext = StoremanScriptContext {scriptContextTxInfo' :: TxInfo', scriptContextPurpose' :: ScriptPurpose}
  deriving (Generic, Prelude.Eq)

-- instance Eq StoremanScriptContext where
--     {-# INLINABLE (==) #-}
--     StoremanScriptContext info purpose == StoremanScriptContext info' purpose' = info == info' && purpose == purpose'

-- data ParamType = Version | Admin | GPK | BalanceWorker | TreasuryCheckVH | OracleWorker | MintCheckVH  | StkVh | StakeCheckVH | NFTRefHolderVH | NFTTreasuryCheckVH | NFTMintCheckVH
-- data GroupInfoParams
--   = GroupInfoParams
--       { params :: [BuiltinByteString]
--       } deriving (Prelude.Eq, Prelude.Show)

-- data AdminDatum
--   = AdminDatum
--       { signatories       :: [BuiltinByteString]
--         , minNumSignatures :: Integer
--       } deriving (Prelude.Eq, Show)

-- data NonsenseDatum
--   = NonsenseDatum
--       { dataReserve :: Integer
--       } deriving (Prelude.Eq, Show)

-- data CheckTokenInfo
--   = CheckTokenInfo
--       { 
--         -- groupInfoNFTCurrency :: CurrencySymbol
--         -- , groupInfoNFTName :: TokenName
--         checkTokenSymbol :: CurrencySymbol
--         , checkTokenName :: TokenName
--       } deriving (Generic, Prelude.Eq)
--         -- deriving anyclass (ToJSON, FromJSON)

-- data GroupNFTTokenInfo
--   = GroupNFTTokenInfo
--       { groupNftSymbol       :: CurrencySymbol
--         , groupNftName :: TokenName
--         -- , groupInfoTokenHolder :: V2.ValidatorHash
--       } deriving  (Generic, Prelude.Eq)

-- data AdminNftTokenInfo
--   = AdminNftTokenInfo
--     { adminNftSymbol :: CurrencySymbol
--       , adminNftName :: TokenName
--     } deriving  (Generic, Prelude.Eq)

-- data GroupAdminNFTInfo
--   = GroupAdminNFTInfo
--       { group :: GroupNFTTokenInfo
--         , admin :: AdminNftTokenInfo
--       } deriving  (Generic, Prelude.Eq)
--         -- deriving anyclass (ToJSON, FromJSON)

-- data GroupAdminNFTCheckTokenInfo
--   = GroupAdminNFTCheckTokenInfo
--       { groupNft :: GroupNFTTokenInfo
--         , adminNft :: AdminNftTokenInfo
--         , checkToken :: CheckTokenInfo
--       } deriving  (Generic, Prelude.Eq)

-- data CrossDatum = CrossDatum
--   {
--     uniqueId :: BuiltinByteString
--     -- crossInfo
--     , inPairId :: Integer
--     , outPairId :: Integer
--     , receiver :: BuiltinByteString
--     -- tokenInfo
--     , feeADA :: Integer
--     , inTokenCurrency :: BuiltinByteString
--     , inTokenName :: BuiltinByteString
--     , inTokenMode :: BuiltinByteString
--     , outTokenCurrency :: BuiltinByteString
--     , outTokenName :: BuiltinByteString
--     , outTokenMode :: Bool -- True: EVM MappingToken False: Cardano native token
--     , constraintCBOR :: BuiltinByteString
--     -- inTokenAmount ::Integer
--     -- outTokenAmountMin :: Integer
--   }

-- PlutusTx.makeLift ''CrossDatum
-- PlutusTx.makeIsDataIndexed ''CrossDatum [('CrossDatum, 0)]

-- PlutusTx.makeLift ''GroupAdminNFTCheckTokenInfo
-- PlutusTx.makeIsDataIndexed ''GroupAdminNFTCheckTokenInfo [('GroupAdminNFTCheckTokenInfo, 0)]

-- PlutusTx.makeLift ''AdminNftTokenInfo
-- PlutusTx.makeIsDataIndexed ''AdminNftTokenInfo [('AdminNftTokenInfo, 0)]

-- -- PlutusTx.unstableMakeIsData ''GroupAdminNFTInfo
-- PlutusTx.makeLift ''GroupAdminNFTInfo
-- PlutusTx.makeIsDataIndexed ''GroupAdminNFTInfo [('GroupAdminNFTInfo, 0)]

-- -- PlutusTx.unstableMakeIsData ''GroupNFTTokenInfo
-- PlutusTx.makeLift ''GroupNFTTokenInfo
-- PlutusTx.makeIsDataIndexed ''GroupNFTTokenInfo [('GroupNFTTokenInfo, 0)]

-- PlutusTx.makeLift ''CheckTokenInfo
-- PlutusTx.makeIsDataIndexed ''CheckTokenInfo [('CheckTokenInfo, 0)]

PlutusTx.makeLift ''TxOut'
PlutusTx.makeIsDataIndexed ''TxOut' [('TxOut', 0)]

PlutusTx.makeLift ''TxInInfo'
PlutusTx.makeIsDataIndexed ''TxInInfo' [('TxInInfo', 0)]

PlutusTx.makeLift ''TxInfo'
PlutusTx.makeIsDataIndexed ''TxInfo' [('TxInfo', 0)]

PlutusTx.makeLift ''StoremanScriptContext
PlutusTx.makeIsDataIndexed ''StoremanScriptContext [('StoremanScriptContext, 0)]

-- PlutusTx.makeLift ''ParamType
-- PlutusTx.makeIsDataIndexed ''ParamType [('Version, 0),('Admin, 1),('GPK, 2),('BalanceWorker, 3),('TreasuryCheckVH, 4),('OracleWorker,5),('MintCheckVH, 6),('StkVh, 7),('StakeCheckVH, 8),('NFTRefHolderVH,9),('NFTTreasuryCheckVH, 10),('NFTMintCheckVH, 11)]

-- PlutusTx.makeLift ''GroupInfoParams
-- PlutusTx.makeIsDataIndexed ''GroupInfoParams [('GroupInfoParams, 0)]

-- PlutusTx.makeLift ''AdminDatum
-- PlutusTx.makeIsDataIndexed ''AdminDatum [('AdminDatum, 0)]

-- PlutusTx.makeLift ''NonsenseDatum
-- PlutusTx.makeIsDataIndexed  ''NonsenseDatum [('NonsenseDatum, 0)]

-- PlutusTx.makeLift ''TreasuryCheckProof
-- PlutusTx.makeIsDataIndexed ''TreasuryCheckProof [('TreasuryCheckProof, 0)]

-- PlutusTx.makeLift ''MintCheckRedeemer
-- PlutusTx.makeIsDataIndexed ''MintCheckRedeemer [('MintCheckRedeemer, 0)]

-- PlutusTx.makeLift ''CheckRedeemer
-- PlutusTx.makeIsDataIndexed ''CheckRedeemer [('BurnCheckToken, 0),('TreasuryCheckProof, 1),('MintCheckRedeemer, 2)]
-- PlutusTx.makeLift ''ScriptPurpose
-- PlutusTx.makeIsDataIndexed
--   ''ScriptPurpose
--   [ ('Minting, 0),
--     ('Spending, 1),
--     ('Rewarding, 2),
--     ('Certifying, 3)
--   ]

{-# INLINABLE getGroupInfoParams #-}
getGroupInfoParams :: GroupInfoParams -> ParamType -> BuiltinByteString
getGroupInfoParams (GroupInfoParams params) typeId = case typeId of
    Version -> params !! 0
    Admin -> params !! 1
    GPK -> params !! 2
    BalanceWorker -> params !! 3
    TreasuryCheckVH -> params !! 4
    OracleWorker -> params !! 5
    MintCheckVH -> params !! 6
    StkVh -> params !! 7
    StakeCheckVH -> params !! 8
    NFTRefHolderVH -> params !! 9
    NFTTreasuryCheckVH -> params !! 10
    NFTMintCheckVH ->params !! 11


{-# INLINABLE packBool #-}
packBool :: Bool -> BuiltinByteString
packBool b  
  | b == True = consByteString 1 emptyByteString
  | otherwise = consByteString 0 emptyByteString


{-# INLINABLE packIntegerArray #-}
-- | Pack an integer into a byte string with a leading
-- sign byte in little-endian order
packIntegerArray :: [Integer] -> BuiltinByteString
packIntegerArray [] = emptyByteString
packIntegerArray [x] = packInteger x
packIntegerArray (i:ls) = appendByteString (packInteger i) (packIntegerArray ls) --tail
  -- where tail = packIntegerArray ls


{-# INLINABLE packInteger #-}
-- | Pack an integer into a byte string with a leading
-- sign byte in little-endian order
packInteger :: Integer -> BuiltinByteString
packInteger k -- = if k < 0 then consByteString 1 (go (negate k) emptyByteString) else consByteString 0 (go k emptyByteString)
  | k == 0 = consByteString 0 emptyByteString
  | k < 0  = consByteString 0x80 (go (negate k) emptyByteString)
  | otherwise = go k emptyByteString
    where
      go n s
        | n == 0            = s
        | otherwise         = go (n `PlutusTx.Prelude.divide` 256) (consByteString (n `modulo` 256) s)


{-# INLINABLE getGroupInfo #-}
getGroupInfo :: TxInfo' -> CurrencySymbol -> TokenName -> GroupInfoParams
getGroupInfo TxInfo'{txInfoReferenceInputs'} groupInfoCurrency groupInfoTokenName = 
  case filter (isGroupInfoToken) $ map (txInInfoResolved') txInfoReferenceInputs' of
    [o] ->case o of 
      (TxOut' _ _ outputDatum _) -> case outputDatum of
          (OutputDatum datum ) -> case (fromBuiltinData $ getDatum datum) of
            Just groupInfo -> groupInfo
  where
    isGroupInfoToken :: TxOut' -> Bool
    isGroupInfoToken (TxOut' (Address credential _) txOutValue _ _) = (assetClassValueOf txOutValue ( assetClass groupInfoCurrency groupInfoTokenName)) > 0

-- {-# INLINABLE getTotalAmountOfAssetInInput #-}
-- getTotalAmountOfAssetInInput :: V2.StoremanScriptContext -> CurrencySymbol -> TokenName -> Integer
-- getTotalAmountOfAssetInInput ctx checkTokenSymbol checkTokenName = 
--       let !totoalOutValue = V2.valueSpent (V2.scriptContextTxInfo ctx)
--           !totalOutAmount = valueOf totoalOutValue checkTokenSymbol checkTokenName
--       in totalOutAmount

{-# INLINABLE findOwnInput' #-}
-- | Find the input currently being validated.
findOwnInput' :: StoremanScriptContext -> Maybe TxInInfo'
findOwnInput' StoremanScriptContext{scriptContextTxInfo'=TxInfo'{txInfoInputs'}, scriptContextPurpose'=Spending txOutRef} =
    find (\TxInInfo'{txInInfoOutRef'} -> txInInfoOutRef' == txOutRef) txInfoInputs'
findOwnInput' _ = Nothing

{-# INLINABLE ownHashes' #-}
-- | Get the validator and datum hashes of the output that is curently being validated
ownHashes' :: StoremanScriptContext -> (ValidatorHash, OutputDatum)
ownHashes' (findOwnInput' -> Just TxInInfo'{txInInfoResolved'=TxOut'{txOutAddress'=Address (ScriptCredential s) _, txOutDatum'=d}}) = (s,d)
ownHashes' _ = traceError "Lg" -- "Can't get validator and datum hashes"

{-# INLINABLE ownHash' #-}
-- | Get the hash of the validator script that is currently being validated.
ownHash' :: StoremanScriptContext -> ValidatorHash
ownHash' p = fst (ownHashes' p)

{-# INLINABLE isSingleAsset #-}
isSingleAsset :: Value -> CurrencySymbol -> TokenName -> Bool
isSingleAsset v cs tk = all (\(cs',tk',_) -> (cs' == cs && tk' == tk) || (cs' == Ada.adaSymbol  && tk' == Ada.adaToken)) $ flattenValue v

{-# INLINABLE getAmountOfCheckTokeninOwnOutput #-}
getAmountOfCheckTokeninOwnOutput :: StoremanScriptContext  -> CurrencySymbol -> TokenName-> BuiltinByteString -> Integer
getAmountOfCheckTokeninOwnOutput ctx checkTokenSymbol checkTokenName stk = 
      let !lockedValue = valueLockedBy' (scriptContextTxInfo' ctx) (ownHash' ctx) stk
          !lockedAmount = valueOf lockedValue checkTokenSymbol checkTokenName
      in 
        if (isSingleAsset lockedValue checkTokenSymbol checkTokenName) then lockedAmount
        else traceError "t"


{-# INLINABLE getNonsenseDatum #-}
getNonsenseDatum ::Datum -> Maybe NonsenseDatum
getNonsenseDatum d = fromBuiltinData @NonsenseDatum $ getDatum d


{-# INLINABLE valueLockedBy' #-}
valueLockedBy' :: TxInfo' -> ValidatorHash -> BuiltinByteString -> Value
valueLockedBy' ptx h stk =
    let 
        targetAddr = Address (ScriptCredential h) (Just (StakingHash (ScriptCredential (ValidatorHash stk))  )) 
        targetDatum = OutputDatum (Datum (PlutusTx.toBuiltinData (NonsenseDatum 1))) 
        outputs = scriptOutputsAt2 targetAddr ptx targetDatum
    in mconcat outputs


-- {-# INLINABLE nonsenseDatum #-}
-- nonsenseDatum :: OutputDatum
-- nonsenseDatum = OutputDatum (Datum (PlutusTx.toBuiltinData (NonsenseDatum 1)))



{-# INLINABLE scriptOutputsAt2' #-}
scriptOutputsAt2' :: Address -> TxInfo' ->[(Datum, Value)]
scriptOutputsAt2' addr p =
    let 
      flt TxOut'{txOutDatum'=d, txOutAddress', txOutValue'} | addr == txOutAddress' = 
        case d of
          OutputDatum datum -> Just (datum, txOutValue')
          _ -> Nothing 
      flt _ = Nothing
    in mapMaybe flt (txInfoOutputs' p)

{-# INLINABLE scriptOutputsAt2 #-}
scriptOutputsAt2 :: Address -> TxInfo' -> OutputDatum ->[Value]
scriptOutputsAt2 addr p od =
    let flt TxOut'{txOutDatum'=d, txOutAddress', txOutValue'} | addr == txOutAddress' &&  d == od = Just txOutValue'
        flt _ = Nothing
    in mapMaybe flt (txInfoOutputs' p)

-- {-# INLINABLE scriptOutputsAt2 #-}
-- scriptOutputsAt2 :: Address -> TxInfo' -> OutputDatum ->[Value]
-- scriptOutputsAt2 addr TxInfo'{V2.txInfoOutputs = os} od = go [] os
--   where
--     go v [] = v
--     go v (TxOut'{txOutValue',txOutAddress',txOutDatum'} : rest) = 
--       if (txOutAddress == addr) && (txOutDatum == od) then go (txOutValue:v) rest
--       else go v rest

{-# INLINABLE outputsOf #-}
-- | Get the list of 'TxOut' outputs of the pending transaction at
--   a given address.
outputsOf :: Address -> TxInfo' -> [(OutputDatum, Value)]
outputsOf addr p =
    let flt TxOut'{txOutDatum'=d, txOutAddress', txOutValue'} | txOutAddress' == addr = Just (d, txOutValue')
        flt _ = Nothing
    in mapMaybe flt (txInfoOutputs' p)

-- {-# INLINABLE valueLockedByAndCheckDatum #-}
-- valueLockedByAndCheckDatum :: TxInfo' -> ValidatorHash -> BuiltinByteString -> BuiltinByteString -> Value
-- valueLockedByAndCheckDatum ptx h stk userData =
--     let 
--       valuesAndDatums = filter (\o -> (serialiseData $ getDatum $ fst o) == userData) (scriptOutputsAt' h stk ptx False)
--       totalValue = mconcat $ map snd valuesAndDatums
--       len = length valuesAndDatums
--     in if len > 1 then traceError "a"
--        else totalValue

-- {-# INLINABLE pubKeyOutputsAt' #-}
-- -- | Get the values paid to a public key address by a pending transaction.
-- pubKeyOutputsAt' :: PubKeyHash -> TxInfo ->  BuiltinByteString -> [Value]
-- pubKeyOutputsAt' pk p stk =
--     let flt TxOut{txOutAddress = Address (PubKeyCredential pk') stk', txOutValue} | pk == pk' &&  stk == (stakeCredentialToBytes stk')= Just txOutValue
--         flt _                             = Nothing
--     in mapMaybe flt (txInfoOutputs p)

-- {-# INLINABLE valuePaidTo' #-}
-- -- | Get the total value paid to a public key address by a pending transaction.
-- valuePaidTo' :: TxInfo -> PubKeyHash -> BuiltinByteString -> Value
-- valuePaidTo' ptx pkh stk = mconcat (pubKeyOutputsAt' pkh ptx stk)

-- {-# INLINEABLE stakeCredentialToBytes #-}
-- stakeCredentialToBytes :: Maybe StakingCredential -> BuiltinByteString
-- stakeCredentialToBytes stk =  case stk of
--   Just stkh -> case stkh of
--     StakingHash c -> case c of
--       PubKeyCredential pkh ->getPubKeyHash pkh
--       ScriptCredential (ValidatorHash s) -> s
--   Nothing -> emptyByteString


{-# INLINABLE valueSpent' #-}
-- | Get the total value of inputs spent by this transaction.
valueSpent' :: TxInfo' -> Value
valueSpent' = foldMap (txOutValue' . txInInfoResolved') . txInfoInputs'


{-# INLINABLE valueProduced' #-}
-- | Get the total value of outputs produced by this transaction.
valueProduced' :: TxInfo' -> Value
valueProduced' = foldMap txOutValue' . txInfoOutputs'
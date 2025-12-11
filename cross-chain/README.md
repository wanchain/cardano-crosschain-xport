# How to compile

## 1. prepare compile environment (with nix-shell )
```shell
git clone https://github.com/IntersectMBO/plutus-apps.git
cd plutus-apps
git checkout v1.0.0-alpha1
nix-shell --extra-experimental-features flakes
```

## 2. compile contract

```shell
cd {project_path}/cross-chain
nix --extra-experimental-features "nix-command flakes" run .#cross-chain:exe:cross-chain --print-build-logs
```

## 3. compile result
All contracts compilecode is in {project_path}/cross-chain/generated-plutus-scripts
{
  description = "cross-chain";

  nixConfig = {
    extra-experimental-features = [ "nix-command" "flakes" ];
    extra-substituters = [ "https://cache.iog.io" "https://public-plutonomicon.cachix.org" "https://mlabs.cachix.org" ];
    extra-trusted-public-keys = [ "hydra.iohk.io:f/Ea+s+dFdN+3Y/G+FDgSq+a5NEWhJGzdjvKNGv0/EQ=" "public-plutonomicon.cachix.org-1:3AKJMhCLn32gri1drGuaZmFrmnue+KkKrhhubQk/CWc=" ];
    allow-import-from-derivation = "true";
    bash-prompt = "\\[\\e[0m\\][\\[\\e[0;2m\\]nix \\[\\e[0;1m\\]mlabs \\[\\e[0;93m\\]\\w\\[\\e[0m\\]]\\[\\e[0m\\]$ \\[\\e[0m\\]";
  };

  inputs = {
    haskell-nix.follows = "bpi/haskell-nix";
    nixpkgs.follows = "bpi/haskell-nix/nixpkgs";
    iohk-nix.follows = "bpi/iohk-nix";

    flake-compat = {
      url = "github:edolstra/flake-compat";
      flake = false;
    };
    bpi = {
      url = github:mlabs-haskell/bot-plutus-interface/7235aa6fba12b0cf368d9976e1e1b21ba642c038;
      inputs.cardano-node.url = github:input-output-hk/cardano-node/e0719fdb491229b113114c2cb009f02c83f6118f;
    };
  };

  outputs = { self, nixpkgs, haskell-nix, bpi, ... }@inputs:
    let
      supportedSystems = [ "x86_64-linux" "x86_64-darwin" ];

      perSystem = nixpkgs.lib.genAttrs supportedSystems;

      nixpkgsFor = system:
        import nixpkgs {
          inherit system;
          overlays = [
            haskell-nix.overlay
            (import "${inputs.iohk-nix}/overlays/crypto")
          ];
          inherit (haskell-nix) config;
        };

      hsProjectFor = system:
        let
          pkgs = nixpkgsFor system;
          project = pkgs.haskell-nix.cabalProject {
            src = ./.;
            compiler-nix-name = "ghc8107";
            inherit (bpi) cabalProjectLocal extraSources;
            modules = bpi.haskellModules;
            shell = {
              withHoogle = true;
              exactDeps = true;
              nativeBuildInputs = with pkgs; [
                # Shell utils
                bashInteractive
                git
                cabal-install

                # Lint / Format
                fd
                hlint
                haskellPackages.apply-refact
                haskellPackages.cabal-fmt
                haskellPackages.fourmolu
                nixpkgs-fmt
              ];
              additional = ps: [
                ps.cardano-crypto-class
                ps.cardano-cli
                ps.plutus-tx-plugin
                ps.plutus-script-utils
                ps.plutus-ledger
                ps.playground-common
              ];
              tools.haskell-language-server = { };
            };
          };
        in
        project;

    in
    {
      project = perSystem hsProjectFor;

      flake = perSystem (system: (hsProjectFor system).flake { });

      packages = perSystem (system: self.flake.${system}.packages);

      apps = perSystem (system: self.flake.${system}.apps);

      check = perSystem (system:
        (nixpkgsFor system).runCommand "combined-check"
          {
            nativeBuildInputs = builtins.attrValues self.checks.${system}
              ++ builtins.attrValues self.flake.${system}.packages
              ++ [ self.flake.${system}.devShell.inputDerivation ];
          } "touch $out");

      checks = perSystem (system: self.flake.${system}.checks);

      devShell = perSystem (system: self.flake.${system}.devShell);
    };
}

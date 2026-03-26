{ pkgs, lib }:

let
  linuxPkgs = lib.optionals pkgs.stdenv.hostPlatform.isLinux [
  ];

  darwinPkgs = lib.optionals pkgs.stdenv.hostPlatform.isDarwin [
  ];

  commonPkgs = [
    # Cardano
    pkgs.aiken

    # JS / Node
    pkgs.nodejs_20
    pkgs.yarn

    # Containers
    pkgs.docker
    pkgs.docker-compose
    
    # General
    pkgs.git
    pkgs.gh
    pkgs.jq
  ];

in

pkgs.mkShell {
  name = "crosschain-dev";

  buildInputs = lib.concatLists [
    commonPkgs
    darwinPkgs
    linuxPkgs
  ];

  shellHook = ''
    export PS1="\n\[\033[1;32m\][nix-shell:\w]\$\[\033[0m\] "
  '';
}

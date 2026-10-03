{
  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
  };

  outputs =
    { nixpkgs, ... }:
    let
      inherit (nixpkgs) lib;
      forAllSystems = lib.genAttrs lib.systems.flakeExposed;
    in
    {
      devShells = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};

          commonPackages = [
            pkgs.python312
            pkgs.uv
            pkgs.pnpm
            pkgs.nodejs_24
          ];

          commonEnv = lib.optionalAttrs pkgs.stdenv.isLinux {
            LD_LIBRARY_PATH = lib.makeLibraryPath pkgs.pythonManylinuxPackages.manylinux1;
            UV_PYTHON_DOWNLOADS = "never";
          };

          commonShellHook = ''
            unset PYTHONPATH
            uv sync
            . .venv/bin/activate
          '';
        in
        {
          default = pkgs.mkShell {
            packages = commonPackages;
            env = commonEnv;
            shellHook = commonShellHook;
          };
        }
      );
    };
}
